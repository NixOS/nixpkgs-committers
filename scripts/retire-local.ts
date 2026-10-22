#!/usr/bin/env node
// Local runner for scripts/retire.ts, authenticating Octokit with `gh auth token`.
// See scripts/README.md for the test sequence.

import { execFileSync } from 'node:child_process';
import { getOctokit } from '@actions/github';
import retire from './retire.ts';

function usage(): never {
  console.error(`Usage: ${process.argv[1]} ORG ACTIVITY_REPO MEMBER_REPO DIR`);
  console.error('');
  console.error('Optionally set CACHE_FILE to a path for persisting activity observations between runs.');
  console.error('Set PROD=1 to actually perform side effects.');
  process.exit(1);
}

const args = process.argv.slice(2);
const [org, activityRepo, memberRepo, dir] = args;
if (args.length !== 4 || !org || !activityRepo || !memberRepo || !dir) {
  usage();
}

const token = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim();
const github = getOctokit(token);

retire({
  github,
  options: {
    org,
    activityRepo,
    memberRepo,
    dir,
    cacheFile: process.env.CACHE_FILE,
    prod: Boolean(process.env.PROD),
  },
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
