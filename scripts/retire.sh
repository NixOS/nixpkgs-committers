#!/usr/bin/env bash
set -euo pipefail
shopt -s nullglob

log() {
  echo "$@" >&2
}

trace() {
  log "Running:" "${@@Q}"
  "$@"
}

effect() {
  log -en "\e[33m"
  if [[ -z "${PROD:-}" ]]; then
    log "Skipping effect:" "${@@Q}"
    # If there's stdin, show it
    if read -t 0 _; then
      sed "s/^/[stdin] /" >&2
    fi
  else
    trace "$@"
  fi
  log -en "\e[0m"
}

usage() {
  log "Usage: $0 ORG ACTIVITY_REPO MEMBER_REPO DIR NOTICE_CUTOFF"
  exit 1
}

ORG=${1:-$(usage)}
ACTIVITY_REPO=${2:-$(usage)}
MEMBER_REPO=${3:-$(usage)}
DIR=${4:-$(usage)}
NOTICE_CUTOFF=${5:-$(usage)}

mainBranch=$(git branch --show-current)
newCutoff=$(date --date="1 year ago" +%s)
noticeCutoff=$(date --date="$NOTICE_CUTOFF" +%s)

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

  # Don't remove people that have been added recently
  if [[ -s "$login" ]]; then
    epochAdded=$(date --date="$(<"$login")" +%s)
    if (( newCutoff < epochAdded )); then
      continue
    fi
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

  branchName=retire-$login
  prInfo=$(trace gh api -X GET /repos/"$ORG"/"$MEMBER_REPO"/pulls -f head="$ORG":"$branchName" --jq '.[0]')
  if [[ -n "$prInfo" ]]; then
    # If there is a PR already
    prNumber=$(jq .number <<< "$prInfo")
    epochCreatedAt=$(date --date="$(jq -r .created_at <<< "$prInfo")" +%s)
    if jq -e .draft <<< "$prInfo" >/dev/null && (( epochCreatedAt < noticeCutoff )); then
      log "$login has a retirement PR due, unmarking PR as draft and commenting with next steps"
      effect gh pr ready --repo "$ORG/$MEMBER_REPO" "$prNumber"
      {
        if (( activityCount > 0 )); then
          echo "One month has passed, @$login has been active again:"
          cat "$tmp/$login"
          echo ""
          echo "If still appropriate, this PR may be merged and implemented by:"
        else
          echo "One month has passed, to this PR should now be merged and implemented by:"
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
      {
        echo "This is an automated PR to retire @$login as a Nixpkgs committers due to not using their commit access for 1 year."
        echo ""
        echo "Make a comment with your motivation to keep commit access, otherwise this PR will be merged and implemented in 1 month."
      } | effect gh api \
        --method POST \
        /repos/"$ORG"/"$MEMBER_REPO"/pulls \
         -f "title=Automatic retirement of @$login" \
         -F "body=@-" \
         -f "head=$ORG:$branchName" \
         -f "base=$mainBranch" \
         -F "draft=true" >/dev/null
    )
  else
    log "$login is active with $activityCount activities"
  fi
  log ""
done
