#!/usr/bin/env bash

source "$(dirname -- "${BASH_SOURCE[0]}")"/common.sh

shopt -s nullglob

usage() {
  log "Usage: $0 ORG ACTIVITY_REPO MEMBER_REPO DIR NOTICE_CUTOFF CLOSE_CUTOFF"
  exit 1
}

ORG=${1:-$(usage)}
ACTIVITY_REPO=${2:-$(usage)}
MEMBER_REPO=${3:-$(usage)}
DIR=${4:-$(usage)}
NOTICE_CUTOFF=${5:-$(usage)}
CLOSE_CUTOFF=${6:-$(usage)}

mainBranch=$(git branch --show-current)
noticeCutoff=$(date --date="$NOTICE_CUTOFF" +%s)

# People that received the commit bit after this date won't be retired
newCutoff=$(date --date="1 year ago" +%s)
# Users whose retirement PRs were closed after this date won't be retired
closeCutoff=$(date --date="$CLOSE_CUTOFF" +%s)

# We need to know when people received their commit bit to avoid retiring them within the first year.
# For now this is done either with the git creation date of the file, or its contents:
#
# | commit bit reception date  | file creation date | file contents  |
# | -------------------------- | ------------------ | -------------- |
# | A)         -∞ - 2024-10-06 | 2025-07-16         | empty          |
# | B) 2024-10-07 - 2025-04-22 | 2025-07-16         | reception date |
# | C) 2025-08-13 - ∞          | reception date     | empty          |
#
# After 2026-04-23 (one year after C started), the file creation date
# for all first-year committers will match the reception date,
# while everybody else will have been a committer for more than one year.
# This means the code can then be simplified to just
# check if the file creation date is in the last year.
#
# For now however, the code needs to check if the file creation date
# is before 2025-07-17 to distinguish between periods A and C,
# so we hardcode that date for the code to use.
createdOnReceptionEpoch=$(date --date=2025-07-17 +%s)

if [[ -z "${PROD:-}" ]]; then
  tmp=$(git rev-parse --show-toplevel)/.tmp
  rm -rf "$tmp"
  mkdir "$tmp"
  log -e "\e[33mPROD=1 is not set, skipping effects and keeping temporary files in $tmp until the next run\e[0m"
else
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' exit
fi

mkdir -p "$DIR"
cd "$DIR"
for login in *; do

  # Figure out when this person received the commit bit
  # Get the unix epoch of the first commit that touched this file
  # --first-parent is important to get the time of when the main branch was changed
  fileCommitEpoch=$(git log --reverse --first-parent --format=%cd --date=unix -- "$login" | head -1)
  if (( fileCommitEpoch < createdOnReceptionEpoch )); then
    # If it was created before creation actually matched the reception date
    # This branch can be removed after 2026-04-23

    if [[ -s "$login" ]]; then
      # If the file is non-empty it indicates an explicit reception date
      receptionEpoch=$(date --date="$(<"$login")" +%s)
    else
      # Otherwise they received the commit bit more than a year ago (start of unix epoch, 1970)
      receptionEpoch=0
    fi
  else
    # Otherwise creation matches reception
    receptionEpoch=$fileCommitEpoch
  fi

  # Latest retirement PR, whether draft, open or closed
  branchName=retire-$login
  prInfo=$(trace gh api -X GET /repos/"$ORG"/"$MEMBER_REPO"/pulls \
    -f state=all \
    -f head="$ORG":"$branchName" \
    --jq '.[0]')
  if [[ -n "$prInfo" ]]; then
    prState=$(jq -r .state <<< "$prInfo")
  else
    prState=none
  fi

  if [[ "$prState" == closed ]] && resetEpoch=$(jq '.closed_at | fromdateiso8601' <<< "$prInfo") && (( closeCutoff < resetEpoch )); then
    log "$login had a retirement PR that was closed recently, skipping retirement check"
    continue
  fi

  # If the commit bit was received after the cutoff date, don't retire in any case
  if (( newCutoff < receptionEpoch )); then
    log "$login became a committer less than 1 year ago, skipping retirement check"
    continue
  fi

  trace gh api -X GET /repos/"$ORG"/"$ACTIVITY_REPO"/activity \
    -f time_period=year \
    -f actor="$login" \
    -f per_page=100 \
    --jq '.[] |
      "- \(.timestamp) [\(.activity_type) on \(.ref | ltrimstr("refs/heads/"))](https://github.com/'"$ORG/$ACTIVITY_REPO"'/\(
        if .activity_type == "branch_creation" then
          "commit/\(.after)"
        elif .activity_type == "branch_deletion" then
          "commit/\(.before)"
        else
          "compare/\(.before)...\(.after)"
        end
      ))"' \
    > "$tmp/$login"
  activityCount=$(wc -l <"$tmp/$login")

  if [[ "$prState" == open ]]; then
    # If there is an open PR already
    prNumber=$(jq .number <<< "$prInfo")
    epochCreatedAt=$(jq '.created_at | fromdateiso8601' <<< "$prInfo")
    if jq -e .draft <<< "$prInfo" >/dev/null && (( epochCreatedAt < noticeCutoff )); then
      log "$login has a retirement PR due, unmarking PR as draft and commenting with next steps"
      effect gh pr ready --repo "$ORG/$MEMBER_REPO" "$prNumber"
      {
        if (( activityCount > 0 )); then
          echo "One month has passed, and @$login has been active again:"
          cat "$tmp/$login"
          echo ""
          echo "If still appropriate, this PR may be merged and implemented by:"
        else
          echo "One month has passed, so this PR should now be merged and implemented by:"
        fi
        echo "- Adding @$login to the [Retired Nixpkgs Contributors team](https://github.com/orgs/NixOS/teams/retired-nixpkgs-contributors)"
        echo '  ```sh'
        echo '  gh api \'
        echo '    --method PUT \'
        echo "    '/orgs/NixOS/teams/retired-nixpkgs-contributors/memberships/$login' \\"
        echo '    -f role=member'
        echo '  ```'
        echo "- Removing @$login from the [Nixpkgs Committers team](https://github.com/orgs/NixOS/teams/nixpkgs-committers)"
        echo '  ```sh'
        echo '  gh api \'
        echo '    --method DELETE \'
        echo "    '/orgs/NixOS/teams/nixpkgs-committers/memberships/$login'"
        echo '  ```'
      } | effect gh api --method POST /repos/"$ORG"/"$MEMBER_REPO"/issues/"$prNumber"/comments -F "body=@-" >/dev/null
    else
      log "$login has a retirement PR pending"
    fi
  elif (( activityCount <= 0 )); then
    log "$login has become inactive, opening a PR"
    # If there is no PR yet, but they have become inactive
    (
      trace git switch -C "$branchName"
      trap 'trace git checkout "$mainBranch" && trace git branch -D "$branchName"' exit
      trace git rm "$login"
      trace git commit -m "Automatic retirement of @$login"
      effect git push -f -u origin "$branchName"
      prNumber=$({
        echo "This is an automated PR to retire @$login as a Nixpkgs committer because they have not used their commit access in the past year."
        echo ""
        echo "@$login: You can make a comment stating why you believe your commit access should be kept. Otherwise, this PR will be merged and implemented in one month."
        echo ""
        echo "> [!NOTE]"
        echo -n "> Commit access is not required for most forms of contributing, including being a maintainer and reviewing PRs."
        echo ' It is only needed for things that require `write` permissions to Nixpkgs, such as merging PRs.'
      } | effect gh api \
        --method POST \
        /repos/"$ORG"/"$MEMBER_REPO"/pulls \
         -f "title=Automatic retirement of @$login" \
         -F "body=@-" \
         -f "head=$ORG:$branchName" \
         -f "base=$mainBranch" \
         -F "draft=true" \
         --jq .number
      )

      effect gh api \
        --method POST \
        /repos/"$ORG"/"$MEMBER_REPO"/issues/"$prNumber"/labels \
        -f "labels[]=retirement" >/dev/null
    )
  else
    log "$login is active with $activityCount activities"
  fi
  log ""
done
