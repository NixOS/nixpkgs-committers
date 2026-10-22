// Automatic retirement of inactive committers.
//
// In CI this runs via actions/github-script (see .github/workflows/retire.yml),
// which provides an authenticated Octokit instance as `github`.
// Locally it runs via scripts/retire-local.ts, which authenticates Octokit
// with `gh auth token`. See scripts/README.md for the test sequence.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import config from './retire-config.ts';

type GitHub = InstanceType<typeof import('@actions/github/lib/utils').GitHub>;

export interface RetireOptions {
  org: string;
  activityRepo: string;
  memberRepo: string;
  dir: string;
  cacheFile?: string;
  prod: boolean;
}

interface CachedActivity {
  mergeEpoch?: number;
  mergePr?: string;
  firstInactive?: number;
}

// Parse a small subset of GNU `date --date` expressions (in UTC), enough for
// the specs this script is invoked with: "now", "yesterday", "<n> <unit> ago"
// (combinable, e.g. "yesterday 1 month ago"), and absolute dates like
// "2024-10-07". Relative specs are evaluated against `now` (in milliseconds),
// so that callers can use the same instant for all of them.
// Returns a unix epoch in seconds.
function parseDate(spec: string, now = Date.now()): number {
  let s = spec.trim();

  const absolute = Date.parse(/^\d{4}-\d{2}-\d{2}/.test(s) ? s : '');
  if (!Number.isNaN(absolute)) {
    return Math.floor(absolute / 1000);
  }

  const d = new Date(now);
  const setters: Record<string, (n: number) => number> = {
    second: (n) => d.setUTCSeconds(d.getUTCSeconds() - n),
    minute: (n) => d.setUTCMinutes(d.getUTCMinutes() - n),
    hour: (n) => d.setUTCHours(d.getUTCHours() - n),
    day: (n) => d.setUTCDate(d.getUTCDate() - n),
    week: (n) => d.setUTCDate(d.getUTCDate() - 7 * n),
    month: (n) => d.setUTCMonth(d.getUTCMonth() - n),
    year: (n) => d.setUTCFullYear(d.getUTCFullYear() - n),
  };

  while (s !== '') {
    let m;
    if ((m = s.match(/^now\b/))) {
      // nothing to do
    } else if ((m = s.match(/^yesterday\b/))) {
      setters.day(1);
    } else if ((m = s.match(/^(\d+) (second|minute|hour|day|week|month|year)s? ago\b/))) {
      setters[m[2]](Number(m[1]));
    } else {
      throw new Error(`Cannot parse date spec ${JSON.stringify(spec)}`);
    }
    s = s.slice(m[0].length).trim();
  }
  return Math.floor(d.getTime() / 1000);
}

function isoSeconds(epoch: number): string {
  return new Date(epoch * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export default async function retire({ github, options }: {
  github: GitHub;
  options: RetireOptions;
}): Promise<void> {
  const {
    org,
    activityRepo,
    memberRepo,
    dir,
    cacheFile,
    prod,
  } = options;

  const log = (msg = '') => console.error(msg);

  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trimEnd();

  const trace = <T>(fn: () => T, description: string): T => {
    log(`Running: ${description}`);
    return fn();
  };

  // Skip side effects unless running in production, but log what would happen
  const effect = <T>(fn: () => T, description: string): T | undefined => {
    if (prod) {
      return trace(fn, description);
    }
    log(`\x1b[33mSkipping effect: ${description}\x1b[0m`);
    return undefined;
  };

  const mainBranch = git('branch', '--show-current');
  // All relative dates are evaluated against this same instant
  const now = Date.now();
  const nowEpoch = Math.floor(now / 1000);

  const noticeCutoff = parseDate(config.noticeCutoffSpec, now);

  // People that received the commit bit after this date won't be retired
  const newCutoff = parseDate(config.newCutoffSpec, now);

  // Users whose retirement PRs were closed after this date won't be retired
  const closeCutoff = parseDate(config.closeCutoffSpec, now);

  // Users first observed as inactive after this date won't be retired yet;
  // they keep being checked until the observation is old enough.
  // This prevents a single spurious empty response from the /commits endpoint
  // from causing an accidental retirement PR (see issue #100).
  const confirmCutoff = parseDate(config.confirmCutoffSpec, now);

  // People are considered active if they merged a PR after this date
  const activityCutoff = parseDate(config.activityCutoffSpec, now);

  // Cached merges newer than this are trusted without querying GitHub again.
  const queryCutoff = parseDate(config.queryCutoffSpec, now);

  let tmp;
  if (!prod) {
    tmp = path.join(git('rev-parse', '--show-toplevel'), '.tmp');
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(tmp);
    log(`\x1b[33mprod is not set, skipping effects and keeping activity files in ${tmp} until the next run\x1b[0m`);
  }

  // Activity observed by previous runs, so that the unreliable /commits
  // endpoint doesn't need to be trusted on a single response (see issue #100).
  // The cache only holds positive evidence (merges the API actually returned)
  // plus the time somebody was first observed as inactive,
  // so a spurious empty response can never make a cached-active user look inactive.
  // Bump this version to invalidate all previously cached data.
  const cacheVersion = 1;
  let cache: Record<string, CachedActivity> = {};
  if (cacheFile) {
    try {
      const parsed = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      if (parsed.version === cacheVersion) {
        cache = parsed.users ?? {};
        log(`Loaded activity cache with ${Object.keys(cache).length} entries from ${cacheFile}`);
      } else {
        log(`Activity cache at ${cacheFile} has wrong version, starting fresh`);
      }
    } catch {
      log(`No usable activity cache at ${cacheFile}, starting fresh`);
    }
  }
  const newCache: Record<string, CachedActivity> = {};

  const logins = fs.readdirSync(dir).sort();
  for (const login of logins) {
    // Figure out when this person received the commit bit
    // Get the unix epoch of the last commit that added this file
    // --first-parent is important to get the time of when the main branch was changed
    const fileCommitEpoch = Number(
      git(
        'log',
        '--first-parent',
        '--no-follow',
        '--diff-filter=A',
        '--max-count=1',
        '--format=%cd',
        '--date=unix',
        '--',
        login,
      ),
    );

    // Latest retirement PR, whether draft, open or closed
    const branchName = `retire-${login}`;
    const prInfo = (
      await trace(
        () =>
          github.rest.pulls.list({
            owner: org,
            repo: memberRepo,
            state: 'all',
            head: `${org}:${branchName}`,
            per_page: 1,
          }),
        `GET /repos/${org}/${memberRepo}/pulls?head=${org}:${branchName}`,
      )
    ).data[0];
    const prState = prInfo ? prInfo.state : 'none';

    if (prInfo?.state === 'closed' && prInfo.closed_at && Date.parse(prInfo.closed_at) / 1000 > closeCutoff) {
      log(`${login} had a retirement PR that was closed recently, skipping retirement check`);
      // Keep the cached merge so the #100 protection survives the skip,
      // but drop the inactivity observation: it isn't being confirmed while skipped,
      // and a stale one would let a single empty response open a PR once the skip ends
      if (cache[login]) {
        newCache[login] = { ...cache[login], firstInactive: 0 };
      }
      continue;
    }

    // If the commit bit was received after the cutoff date, don't retire in any case
    if (fileCommitEpoch > newCutoff) {
      log(`${login} became a committer less than 1 year ago, skipping retirement check`);
      if (cache[login]) {
        newCache[login] = { ...cache[login], firstInactive: 0 };
      }
      continue;
    }

    // What previous runs observed about this person's merge activity
    let { mergeEpoch = 0, mergePr = '', firstInactive = 0 } = cache[login] ?? {};

    const activityLines: { epoch: number; pr: string; line: string }[] = [];
    let queried = false;
    if (prState !== 'open' && mergeEpoch > queryCutoff) {
      // Recent cached activity already rules out retirement,
      // no need to bother the unreliable /commits endpoint
    } else {
      queried = true;
      // For an open PR the comment lists activity from the whole past year;
      // otherwise only merges newer than the cached one are of interest
      const sinceEpoch =
        prState === 'open' ? activityCutoff : Math.max(activityCutoff, mergeEpoch + 1);
      const commits = (
        await trace(
          () =>
            github.rest.repos.listCommits({
              owner: org,
              repo: activityRepo,
              since: isoSeconds(sinceEpoch),
              author: login,
              committer: 'web-flow',
              per_page: 100,
            }),
          `GET /repos/${org}/${activityRepo}/commits?author=${login}&since=${isoSeconds(sinceEpoch)}`,
        )
      ).data;
      for (const commit of commits) {
        // PR merge commits have two parents. We also check it’s an
        // authentic GitHub commit, because… why not?
        if (commit.parents.length !== 2 || !commit.commit.verification?.verified || !commit.commit.committer?.date) {
          continue;
        }
        const m = commit.commit.message.match(/ \((#[0-9]+)\)$/m);
        if (!m) {
          continue;
        }
        activityLines.push({
          epoch: Math.floor(Date.parse(commit.commit.committer.date) / 1000),
          pr: m[1],
          line: `- \`${commit.commit.committer.date}\` – ${org}/${activityRepo}${m[1]}`,
        });
      }
    }

    if (activityLines.length > 0) {
      // Cache the newest merge (not trusting the endpoint's result ordering)
      const newest = activityLines.reduce((a, b) => (a.epoch >= b.epoch ? a : b));
      if (newest.epoch > mergeEpoch) {
        mergeEpoch = newest.epoch;
        mergePr = newest.pr;
      }
      firstInactive = 0;
    } else if (queried && firstInactive === 0) {
      // An empty response might just be a timeout of the endpoint (issue #100),
      // so this only starts the inactivity clock; retirement additionally needs
      // all queries until the confirmation cutoff to keep coming back empty
      firstInactive = nowEpoch;
    }

    // Remember the observations for the cache written at the end of the run
    newCache[login] = { mergeEpoch, mergePr, firstInactive };

    if (tmp) {
      fs.writeFileSync(
        path.join(tmp, login),
        activityLines.map((a) => a.line + '\n').join(''),
      );
    }

    if (prInfo?.state === 'open') {
      if (activityLines.length === 0 && mergeEpoch > activityCutoff) {
        // The query came back empty even though the cache proves activity
        // (issue #100), so reconstruct the activity list from the cache
        activityLines.push({
          epoch: mergeEpoch,
          pr: mergePr,
          line: `- \`${isoSeconds(mergeEpoch)}\` – ${org}/${activityRepo}${mergePr}`,
        });
      }
      // If there is an open PR already
      const prNumber = prInfo.number;
      const epochCreatedAt = Date.parse(prInfo.created_at) / 1000;
      if (prInfo.draft && epochCreatedAt < noticeCutoff) {
        log(`${login} has a retirement PR due, unmarking PR as draft and commenting with next steps`);
        await effect(
          () =>
            github.graphql(
              `mutation($id: ID!) {
                markPullRequestReadyForReview(input: { pullRequestId: $id }) {
                  pullRequest { number }
                }
              }`,
              { id: prInfo.node_id },
            ),
          `markPullRequestReadyForReview ${org}/${memberRepo}#${prNumber}`,
        );
        const bodyLines: string[] = [];
        if (activityLines.length > 0) {
          bodyLines.push(
            `One month has passed, and @${login} has been active again:`,
            ...activityLines.map((a) => a.line),
            '',
            'If still appropriate, this PR may be merged and implemented by:',
          );
        } else {
          bodyLines.push('One month has passed, so this PR should now be merged and implemented by:');
        }
        bodyLines.push(
          `- Adding @${login} to the [Retired Nixpkgs Contributors team](https://github.com/orgs/NixOS/teams/retired-nixpkgs-contributors)`,
          '  ```sh',
          '  gh api \\',
          '    --method PUT \\',
          `    '/orgs/NixOS/teams/retired-nixpkgs-contributors/memberships/${login}' \\`,
          '    -f role=member',
          '  ```',
          `- Removing @${login} from the [Nixpkgs Committers team](https://github.com/orgs/NixOS/teams/nixpkgs-committers)`,
          '  ```sh',
          '  gh api \\',
          '    --method DELETE \\',
          `    '/orgs/NixOS/teams/nixpkgs-committers/memberships/${login}'`,
          '  ```',
        );
        await effect(
          () =>
            github.rest.issues.createComment({
              owner: org,
              repo: memberRepo,
              issue_number: prNumber,
              body: bodyLines.join('\n'),
            }),
          `POST comment on ${org}/${memberRepo}#${prNumber}:\n${bodyLines.join('\n')}`,
        );
      } else {
        log(`${login} has a retirement PR pending`);
      }
    } else if (activityLines.length > 0 || mergeEpoch > activityCutoff) {
      // Merges returned by the query are always newer than yearAgo (the since parameter),
      // so activityLines being non-empty implies mergeEpoch > yearAgo.
      if (activityLines.length > 0) {
        log(`${login} is active with ${activityLines.length} new merges`);
      } else {
        log(`${login} is active, last known merge ${mergePr} on ${isoSeconds(mergeEpoch)} (cached)`);
      }
    } else if (firstInactive > confirmCutoff) {
      log(`${login} appears inactive since ${isoSeconds(firstInactive)}, continuing to check before opening a PR`);
    } else {
      log(`${login} has become inactive, opening a PR`);
      // If there is no PR yet, but they have become inactive
      try {
        trace(() => git('switch', '-C', branchName), `git switch -C ${branchName}`);
        trace(() => git('rm', login), `git rm ${login}`);
        trace(
          () => git('commit', '-m', `Automatic retirement of @${login}`),
          `git commit -m 'Automatic retirement of @${login}'`,
        );
        effect(
          () => git('push', '-f', '-u', 'origin', branchName),
          `git push -f -u origin ${branchName}`,
        );
        const body = [
          `This is an automated PR to retire @${login} as a Nixpkgs committer because they have not used their commit access in the past year.`,
          '',
          `@${login}: You can make a comment stating why you believe your commit access should be kept. Otherwise, this PR will be merged and implemented in one month.`,
          '',
          '> [!NOTE]',
          '> Commit access is not required for most forms of contributing, including being a maintainer and reviewing PRs.' +
            ' It is only needed for things that require `write` permissions to Nixpkgs, such as merging PRs.',
        ].join('\n');
        const pr = await effect(
          () =>
            github.rest.pulls.create({
              owner: org,
              repo: memberRepo,
              title: `Automatic retirement of @${login}`,
              body,
              head: `${org}:${branchName}`,
              base: mainBranch,
              draft: true,
            }),
          `POST /repos/${org}/${memberRepo}/pulls (retirement PR for @${login}):\n${body}`,
        );
        if (pr) {
          await effect(
            () =>
              github.rest.issues.addLabels({
                owner: org,
                repo: memberRepo,
                issue_number: pr.data.number,
                labels: ['retirement'],
              }),
            `POST retirement label on ${org}/${memberRepo}#${pr.data.number}`,
          );
        }
      } finally {
        trace(() => git('checkout', mainBranch), `git checkout ${mainBranch}`);
        trace(() => git('branch', '-D', branchName), `git branch -D ${branchName}`);
      }
    }
    log();
  }

  if (cacheFile) {
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(
      cacheFile + '.tmp',
      JSON.stringify({ version: cacheVersion, users: newCache }, null, 2) + '\n',
    );
    fs.renameSync(cacheFile + '.tmp', cacheFile);
    log(`Wrote activity cache to ${cacheFile}`);
  }
}
