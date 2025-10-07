# Nixpkgs Committer management script testing

The recommended way to test these scripts is to run them in a GitHub test organisation with the right setup.
Since creating your own takes some time, you can just ask @infinisil to get added to his test setup instead,
whose identifiers will be used here.

## Setup

### One-time

- [infinisil-test-org](https://github.com/infinisil-test-org): A GitHub organisation you're part of
- Repositories:
  - [infinisil-test-org/empty](https://github.com/infinisil-test-org/empty): An empty one with no activity on it
  - [infinisil-test-org/active](https://github.com/infinisil-test-org/active): One where you have some activity
  - [infinisil-test-org/nixpkgs-committers](https://github.com/infinisil-test-org/nixpkgs-committers): A fork of the upstream repo

  Useful to keep the first two separate for testing, because it's not possible to "undo" activity on a repo.
- [@infinisil-test-org/actors](https://github.com/orgs/infinisil-test-org/teams/actors): A team you're part of, needs write access to the `active` and `nixpkgs-committers` repository

### Per-user

Once you have the above setup (or got @infinisil to add yourself to his), you have to prepare the following:

- Add some activity of yours to the `active` repo.
  To cover all code branches it's recommended to create, push to and delete a branch.
  You can do this from the web interface.
- Get the GitHub CLI available (`pkgs.github-cli`) and authenticate it using `gh auth login`
- A local Git clone of this repository with the `origin` remote set to the test repository:
  ```bash
  git remote add upstream git@github.com:NixOS/nixpkgs-committers.git
  git remote set-url origin git@github.com:infinisil-test-org/nixpkgs-committers.git
  ```

## Testing `sync.sh`

This script has no external effects and as such can be easily tested by running:

```bash
scripts/sync.sh infinisil-test-org actors members-test
```

Check that it synchronises the files in the `members-test` directory with the team members of the `actors` team.

## `retire.sh`

This script has external effects and as such needs a bit more care when testing.

### Setup (important!)

To avoid other users getting pings, ensure that the `members-test` directory contains only simulated new users and your own user (simulated to have been added over a year ago), then commit and push it for testing:

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

The following sequence tests all code paths:

1. Run the script with the `active` repo argument to simulate CI running without inactive users:
   ```bash
   scripts/retire.sh infinisil-test-org active nixpkgs-committers members-test 'yesterday 1 month ago' now
   ```

   Check that no PR would be opened.
2. Run the script with the `empty` repo argument to simulate CI running with inactive users:

   ```bash
   scripts/retire.sh infinisil-test-org empty nixpkgs-committers members-test 'yesterday 1 month ago' now
   ```

   Check that it would only create a PR for your own user and not the "new-committer-1" or "new-committer-2" user before running it again with `PROD=1` to actually do it:

   ```bash
   PROD=1 scripts/retire.sh infinisil-test-org empty nixpkgs-committers members-test 'yesterday 1 month ago' now
   ```

   Check that it created the PR appropriately, including assigning the "retirement" label.
   You can undo this step by closing the PR.
3. Run it again to simulate CI running again later:
   ```bash
   PROD=1 scripts/retire.sh infinisil-test-org empty nixpkgs-committers members-test 'yesterday 1 month ago' now
   ```
   Check that no other PR is opened.
4. Run it again with `now` as the notice cutoff date to simulate the time interval passing:
   ```bash
   PROD=1 scripts/retire.sh infinisil-test-org empty nixpkgs-committers members-test now now
   ```
   Check that it undrafted the previous PR and posted an appropriate comment.
5. Run it again to simulate CI running again later:
   ```bash
   PROD=1 scripts/retire.sh infinisil-test-org empty nixpkgs-committers members-test now now
   ```
   Check that no other PR is opened.
6. Reset by marking the PR as a draft again, then run it again with the `active` repo argument to simulate activity during the time interval:
   ```bash
   PROD=1 scripts/retire.sh infinisil-test-org active nixpkgs-committers members-test now now
   ```
   Check that it gets undrafted with a comment listing the new activity.
8. Close the PR, then run the script again with no activity and for an earlier close cutoff, simulating that the retirement was delayed:
   ```bash
   PROD=1 scripts/retire.sh infinisil-test-org empty nixpkgs-committers members-test now '1 day ago'
   ```

   Check that no other PR is opened.
