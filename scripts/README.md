# Nixpkgs Committer management script testing

The recommended way to test these scripts is to run them in a GitHub test organisation with the right setup.
Since creating your own takes some time, you can just ask @philiptaron to get added to the nixos-test-org test setup instead,
whose identifiers will be used here.

## Setup

### One-time

- [nixos-test-org](https://github.com/nixos-test-org): A GitHub organisation you're part of
- Repositories:
  - [nixos-test-org/empty](https://github.com/nixos-test-org/empty): A repository with only one commit, not attributed to your GitHub user
  - [nixos-test-org/active](https://github.com/nixos-test-org/active): One where you have some activity
  - [nixos-test-org/nixpkgs-committers](https://github.com/nixos-test-org/nixpkgs-committers): A copy of the upstream repo with the `nomination` and `retirement` labels, and with GitHub Actions disabled so the scheduled workflows don't run

  Useful to keep the first two separate for testing, because it's not possible to "undo" activity on a repo.
- [@nixos-test-org/actors](https://github.com/orgs/nixos-test-org/teams/actors): A team you're part of, needs write access to the `active` and `nixpkgs-committers` repository

### Per-user

Once you have the above setup (or got added to nixos-test-org), you have to prepare the following:

- Add some activity of yours to the `active` repo.
  To match Nixpkgs, it’s recommended to do this by setting the “Default commit message” for merge commits to “Pull request title”, then creating and merging a PR.
  You can do this from the web interface.
- Get the GitHub CLI available (`pkgs.github-cli`) and authenticate it using `gh auth login`
- A local Git clone of this repository with the `origin` remote set to the test repository:
  ```bash
  git remote add upstream git@github.com:NixOS/nixpkgs-committers.git
  git remote set-url origin git@github.com:nixos-test-org/nixpkgs-committers.git
  ```

## Testing `sync.sh`

This script has no external effects and as such can be easily tested by running:

```bash
scripts/sync.sh nixos-test-org actors members-test
```

Check that it synchronises the files in the `members-test` directory with the team members of the `actors` team.

## Testing `nomination.sh`

This script does not depend on the current repository, but has some external effects.
For testing, we'll use [PR #3](https://github.com/nixos-test-org/nixpkgs-committers/pull/3) and [issue #2](https://github.com/nixos-test-org/nixpkgs-committers/issues/2).

To test:
1. Delete all labels of the PR and reset the title:
   ```bash
   gh api --method DELETE /repos/nixos-test-org/nixpkgs-committers/issues/3/labels
   gh api --method PATCH /repos/nixos-test-org/nixpkgs-committers/pulls/3 -f title="A non-conforming title"
   ```
1. Run the script while simulating that a non-nomination PR was opened:
   ```bash
   scripts/nomination.sh members nixos-test-org/nixpkgs-committers 3 2 <<< "removed members/ghost"
   ```

   Ensure that it exits with 0 and wouldn't run any effects.
1. Run the script while simulating that multiple users were nominated together:
   ```bash
   scripts/nomination.sh members nixos-test-org/nixpkgs-committers 3 2 <<< "removed members/foo"$'\n'"added members/bar"
   ```

   Ensure that it exits with non-0 and wouldn't run any effects.
1. Run the script simulating a successful nomination
   ```bash
   scripts/nomination.sh members nixos-test-org/nixpkgs-committers 3 2 <<< "added members/ghost"
   ```

   Ensure that it exits with 0 and would run effects to label the PR, change the title and post a comment in the issue.
1. Rerun with effects
   ```bash
   PROD=1 scripts/nomination.sh members nixos-test-org/nixpkgs-committers 3 2 <<< "added members/ghost"
   ```

## Testing `retire.ts`

In CI, `retire.ts` runs via [`actions/github-script`](https://github.com/actions/github-script).
Locally it can be run with `scripts/retire-local.ts`, which authenticates an Octokit client using `gh auth token`.
Run `nix-shell` in the repository root to get Node.js and `gh`; you still need to authenticate with `gh auth login`.
The scripts use Node.js 24's built-in TypeScript support, so no compilation step is needed.
Run `npm test --prefix scripts` to typecheck the scripts and run the test suite.

Retirement date cutoffs are configured in [`retire-config.ts`](retire-config.ts).
To simulate different cutoffs while testing, edit that file locally and restore
the production values when finished.

This script has external effects and as such needs a bit more care when testing.

### Setup (important!)

To avoid other users getting pings, ensure that the `members-test` directory contains only simulated new users and your own user (simulated to have been added over six months ago), then commit and push it for testing:

```bash
me=$(gh api /user --jq .login)
git switch -C "test-$me"
rm -rf members-test
mkdir -p members-test

touch members-test/"$me"
date +%F > "members-test/new-committer-1"
git add members-test
GIT_COMMITTER_DATE=$(date --date @0) git commit -m testing

touch "members-test/new-committer-2"
git add members-test
git commit -m testing
git push -f -u origin HEAD
```

### Test sequence

The following sequence tests all code paths.

Before starting, set `closeCutoffSpec` and `confirmCutoffSpec` to `now` in `retire-config.ts` so that a single run is enough to open a retirement PR.
The production value of `confirmCutoffSpec` is `7 days ago`, which together with the `CACHE_FILE` activity cache (persisted between runs as a workflow artifact) requires a week of daily runs to agree before a PR is opened.

1. Run the script with the `active` repo argument to simulate CI running without inactive users:
   ```bash
   scripts/retire-local.ts nixos-test-org active nixpkgs-committers members-test
   ```

   Check that no PR would be opened.
1. Run the previous command again with `CACHE_FILE` set:
   ```bash
   CACHE_FILE=.tmp-cache.json scripts/retire-local.ts nixos-test-org active nixpkgs-committers members-test
   CACHE_FILE=.tmp-cache.json scripts/retire-local.ts nixos-test-org active nixpkgs-committers members-test
   rm .tmp-cache.json
   ```

   Check that the first run writes your activity to the cache file and that the second run skips the `/commits` query for your user because of it.
1. Run the script with the `empty` repo argument to simulate CI running with inactive users:

   ```bash
   scripts/retire-local.ts nixos-test-org empty nixpkgs-committers members-test
   ```

   Check that it would only create a PR for your own user and not the "new-committer-1" or "new-committer-2" user.
   Also check that with `confirmCutoffSpec` temporarily set to `7 days ago` (as used in CI), no PR would be opened yet:

   ```bash
   scripts/retire-local.ts nixos-test-org empty nixpkgs-committers members-test
   ```

   Set `confirmCutoffSpec` back to `now`, then run it again with `PROD=1` to actually do it:

   ```bash
   PROD=1 scripts/retire-local.ts nixos-test-org empty nixpkgs-committers members-test
   ```

   Check that it created the PR appropriately, including assigning the "retirement" label.
   You can undo this step by closing the PR.
1. Run it again to simulate CI running again later:
   ```bash
   PROD=1 scripts/retire-local.ts nixos-test-org empty nixpkgs-committers members-test
   ```
   Check that no other PR is opened.
1. Set `noticeCutoffSpec` to `now` and run it again to simulate the time interval passing:
   ```bash
   PROD=1 scripts/retire-local.ts nixos-test-org empty nixpkgs-committers members-test
   ```
   Check that it undrafted the previous PR and posted an appropriate comment.
1. Run it again to simulate CI running again later:
   ```bash
   PROD=1 scripts/retire-local.ts nixos-test-org empty nixpkgs-committers members-test
   ```
   Check that no other PR is opened.
1. Reset by marking the PR as a draft again, then run it again with the `active` repo argument to simulate activity during the time interval:
   ```bash
   PROD=1 scripts/retire-local.ts nixos-test-org active nixpkgs-committers members-test
   ```
   Check that it gets undrafted with a comment listing the new activity.
1. Close the PR, set `closeCutoffSpec` to `1 day ago`, then run the script again with no activity, simulating that the retirement was delayed:
   ```bash
   PROD=1 scripts/retire-local.ts nixos-test-org empty nixpkgs-committers members-test
   ```

   Check that no other PR is opened.

Restore the production date specs in `retire-config.ts` after testing.
