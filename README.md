# Nixpkgs committers

This repository publicly tracks the [current members](./members) and [changes](../../commits/main/members)
of the [Nixpkgs Committers](https://github.com/orgs/nixos/teams/nixpkgs-committers) team,
whose members have write access to [Nixpkgs](https://github.com/nixos/nixpkgs).

The [Nixpkgs core team](https://github.com/NixOS/org/blob/main/doc/nixpkgs-core.md)
maintain the member list in this repository according to the [documented procedures](https://github.com/NixOS/org/blob/main/doc/nixpkgs-committers.md).

## Nominations

To nominate yourself or somebody else:
1. Check [open nominations](/../../issues?q=state%3Aopen%20label%3Anomination) to make sure the user hasn't been nominated already.
1. [Click this link](/../../new/main/members?filename=%3CGITHUB_HANDLE%3E) to create a new file in the [`members` directory](./members).
1. Leave the file contents empty and replace `<GITHUB_HANDLE>` with the handle (without `@`) of the user you'd like to nominate .
1. Click on "Commit changes..." and follow the steps to create a PR.
1. State your motivation for the nomination in the PR description.

Such nominations are also automatically announced in [this issue](/../../issues/35), which you can subscribe to for updates.

## Semi-automatic synchronisation

Every day, [a GitHub Action workflow](./.github/workflows/sync.yml) runs
to synchronise the members of the GitHub team with the member list in this repository.
If they don't match, an automated PR is created,
which should be merged by the Nixpkgs commit delegators to reconcile the mismatch.

## Semi-automatic retirement

Every day, [a GitHub Action workflow](./.github/workflows/retire.yml) runs
to check if any Nixpkgs committers have not used their commit access within the last year,
in which case an automated PR is created to remove them from the member list.
This is according to [RFC 55](https://github.com/NixOS/rfcs/blob/master/rfcs/0055-retired-committers.md)
and the SC-approved [amendment](https://github.com/NixOS/org/issues/91).

The PR will ping the user and inform them that it will by default be merged and implemented in one month.
If the PR is still open one month later,
an automated comment will be posted with the next steps for the Nixpkgs commit delegators.

If the PR is closed, retirement is delayed by another year.

## Automation setup

Automation depends on a GitHub App with the following permissions:
- Organisation: Members read only (to be able to read the team members)
- Repository: Pull requests read write, Contents read write (to be able to create PRs in this repository)

The GitHub App should only be installed on this repository.
To give the workflows access to the GitHub App:
- Configure the App ID as the repository _variable_ `APP_ID`
- Configure the private key as the repository _secret_ `PRIVATE_KEY`
