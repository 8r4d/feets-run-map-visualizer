#!/usr/bin/env bash
# Runs feets' tests against a throwaway copy of the site: its own MariaDB and
# PHP's built-in server in a temp folder, all removed afterwards. Nothing
# touches feets-config.php or a real database.
#
#   tests/run.sh                 everything
#   tests/run.sh unit            just tests/unit.test.mjs (no database needed)
#   tests/run.sh api browser     those files
#
# Needs: php (with pdo_mysql), mariadb (mariadbd, mariadb-install-db),
# node 22+, and Google Chrome or Chromium for the browser tests (skipped
# without it). On a Mac: brew install php mariadb node.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
names=("$@")
[ ${#names[@]} -eq 0 ] && names=(unit api browser)
files=()
for n in "${names[@]}"; do files+=("$ROOT/tests/$n.test.mjs"); done

# Unit tests alone need no server.
if [ "${names[*]}" = "unit" ]; then
  exec node --test "${files[@]}"
fi

# mktemp's folder, not the repo: MariaDB's socket path must be short.
TMP="$(mktemp -d)"
DB_PORT=$((33000 + RANDOM % 1000))
WEB_PORT=$((8800 + RANDOM % 1000))
cleanup() {
  [ -n "${PHP_PID:-}" ] && kill "$PHP_PID" 2>/dev/null || true
  [ -n "${DB_PID:-}" ] && kill "$DB_PID" 2>/dev/null && wait "$DB_PID" 2>/dev/null || true
  rm -rf "$TMP"
}
trap cleanup EXIT

echo "Starting MariaDB on port ${DB_PORT}…"
mariadb-install-db --datadir="$TMP/data" --auth-root-authentication-method=normal --skip-test-db >"$TMP/db-install.log" 2>&1
mariadbd --datadir="$TMP/data" --socket="$TMP/s" --port="$DB_PORT" --bind-address=127.0.0.1 >"$TMP/db.log" 2>&1 &
DB_PID=$!
for _ in $(seq 50); do
  mariadb --socket="$TMP/s" -uroot -e 'SELECT 1' >/dev/null 2>&1 && break
  sleep 0.2
done
mariadb --socket="$TMP/s" -uroot -e "CREATE DATABASE feets; CREATE USER 'feets'@'127.0.0.1' IDENTIFIED BY 'test';
  GRANT ALL ON feets.* TO 'feets'@'127.0.0.1';"

# The site: a copy of public/, with its config one folder up as on a host.
# (Copied, not linked: a link would make api.php find the real config.)
mkdir -p "$TMP/site"
cp -R "$ROOT/public" "$TMP/site/public"
cat >"$TMP/site/feets-config.php" <<EOF
<?php
return [
    'app_password' => 'test-setup-password',
    'mysql' => ['host' => '127.0.0.1', 'port' => $DB_PORT, 'user' => 'feets', 'password' => 'test', 'database' => 'feets'],
    'strava' => ['client_id' => '', 'client_secret' => ''],
];
EOF

echo "Starting PHP on port ${WEB_PORT}…"
php -S "127.0.0.1:$WEB_PORT" -t "$TMP/site/public" >"$TMP/php.log" 2>&1 &
PHP_PID=$!
for _ in $(seq 50); do
  curl -s "http://127.0.0.1:$WEB_PORT/api.php?action=me" >/dev/null 2>&1 && break
  sleep 0.1
done

export FEETS_URL="http://127.0.0.1:$WEB_PORT/"
export FEETS_SETUP_PASSWORD='test-setup-password'
export FEETS_DB="mariadb --socket=$TMP/s -uroot feets"
status=0
# One file at a time: they share the database and the admin account.
node --test --test-concurrency=1 "${files[@]}" || status=$?
if [ $status -ne 0 ]; then
  echo; echo "--- php.log (last 30 lines) ---"; tail -30 "$TMP/php.log"
fi
exit $status
