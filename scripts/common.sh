set -euo pipefail

export TZ=UTC

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
