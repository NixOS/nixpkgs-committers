#!/usr/bin/env bash

source "$(dirname -- "${BASH_SOURCE[0]}")"/common.sh

usage() {
  log "Usage: $0 ORG TEAM DIR"
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
      touch "$DIR.new/$login"
    fi
  done

rm -rf "$DIR"
mv "$DIR.new" "$DIR"
