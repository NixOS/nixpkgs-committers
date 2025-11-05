#!/usr/bin/env bash

source "$(dirname -- "${BASH_SOURCE[0]}")"/common.sh

shopt -s nocasematch

usage() {
  log "Usage: $0 MEMBERS_DIR REPOSITORY PR_NUMBER ANNOUNCEMENT_ISSUE_NUMBER"
  exit 1
}

MEMBERS_DIR=${1:-$(usage)}
REPOSITORY=${2:-$(usage)}
PR_NUMBER=${3:-$(usage)}
ANNOUNCEMENT_ISSUE_NUMBER=${4:-$(usage)}

log "Waiting to get changed files on stdin.."
readarray -t changedFiles
declare -p changedFiles

regex="^added $MEMBERS_DIR/([^/]+)$"

nomineeHandle=
for statusFilename in "${changedFiles[@]}"; do
  if [[ "$statusFilename" =~ $regex ]]; then
    nomineeHandle=${BASH_REMATCH[1]}
    break
  fi
done

if [[ -z "$nomineeHandle" ]]; then
  log "Not a nomination PR"
  exit 0
elif (( "${#changedFiles[@]}" > 1 )); then
  log "Only one person can be nominated per PR"
  exit 1
fi

effect gh api \
  --method PATCH \
  "/repos/$REPOSITORY/pulls/$PR_NUMBER" \
   -f title="Nominate @$nomineeHandle" \

effect gh api \
  --method POST \
  "/repos/$REPOSITORY/issues/$ANNOUNCEMENT_ISSUE_NUMBER/comments" \
  -F "body=@-" << EOF
The user @$nomineeHandle has been nominated. Endorsements and discussions should be held in the corresponding nomination PR: #$PR_NUMBER
EOF

effect gh api \
  --method POST \
  "/repos/$REPOSITORY/issues/$PR_NUMBER/labels" \
  -f "labels[]=nomination"
