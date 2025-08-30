#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo >&2 "Usage: $0 ORG TEAM DIR"
  exit 1
}

ORG=${1:-$(usage)}
TEAM=${2:-$(usage)}
DIR=${3:-$(usage)}

mkdir -p "$DIR.new"

gh api /orgs/"$ORG"/teams/"$TEAM"/members --paginate --jq '.[].login' |
  while read -r login; do
    if [[ -f "$DIR/$login" ]]; then
      mv "$DIR/$login" "$DIR.new"
    else
      # Keep track of when the user was added
      date +%F > "$DIR.new/$login"
    fi
  done

rm -rf "$DIR"
mv "$DIR.new" "$DIR"
