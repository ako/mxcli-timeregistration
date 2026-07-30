#!/usr/bin/env bash
#
# Puts the app back into the state the suite expects: an empty database, so the
# after-startup microflow reseeds it, and a running app to reseed into.
#
#   bash tests/reset.sh          # reset and restart, wait for the seed
#   bash tests/reset.sh --stop   # just stop the app
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="$ROOT/TimeRegistration"
LOG="${TEST_RUN_LOG:-/tmp/timereg-test-run.log}"

stop_app() {
  # `pkill -f` would match this script's own command line, so match the process
  # name instead and kill the mxbuild daemon it leaves holding port 6543.
  ps -eo pid,args --no-headers | awk '/mxcli run --local/ && !/awk/ {print $1}' | xargs -r kill 2>/dev/null || true
  sleep 5
  ps -eo pid,comm --no-headers | awk '$2 == "mxbuild" {print $1}' | xargs -r kill 2>/dev/null || true
  sleep 2
}

if [ "${1:-}" = "--stop" ]; then
  stop_app
  echo "app stopped"
  exit 0
fi

echo "==> stopping the app"
stop_app

echo "==> dropping and recreating the database"
sudo -u postgres psql -qc "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='timeregistration'" >/dev/null 2>&1 || true
sudo -u postgres psql -qc "DROP DATABASE IF EXISTS timeregistration" >/dev/null
sudo -u postgres psql -qc "CREATE DATABASE timeregistration OWNER mendix" >/dev/null

echo "==> starting the app (a cold build takes a few minutes)"
cd "$APP"
nohup ./mxcli run --local -p TimeRegistration.mpr --ensure-db --watch=false > "$LOG" 2>&1 &

for _ in $(seq 1 100); do
  sleep 6
  if curl -fsS -o /dev/null http://127.0.0.1:8080/ 2>/dev/null; then
    echo "==> app is up"
    # The seed runs after startup; wait for it to say so before testing.
    for _ in $(seq 1 20); do
      if grep -q "TimeRegSeed: Demo data ready" "$APP/.mxcli/runtime.log" 2>/dev/null; then
        echo "==> demo data seeded"
        exit 0
      fi
      sleep 3
    done
    echo "!! app is up but the seed never reported ready — see $APP/.mxcli/runtime.log" >&2
    exit 1
  fi
  if grep -q "^Error:" "$LOG" 2>/dev/null; then
    echo "!! the app failed to start:" >&2
    grep -A3 "^Error:" "$LOG" | head -8 >&2
    exit 1
  fi
done

echo "!! timed out waiting for the app — see $LOG" >&2
exit 1
