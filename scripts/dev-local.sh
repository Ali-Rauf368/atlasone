#!/usr/bin/env bash
# One-command local stack without Docker: PostgreSQL, MongoDB, LDAP, API, web.
# Data lives in ./.local (git-ignored). Services already listening on their port are reused.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOCAL="$ROOT/.local"
mkdir -p "$LOCAL"

PG_PORT=55432 MONGO_PORT=57017 LDAP_PORT=3890 API_PORT=4000 WEB_PORT=5173
listening() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
say() { printf '\033[1;34m[atlasone]\033[0m %s\n' "$*"; }

# --- dependencies ---
for d in api web; do [ -d "$ROOT/$d/node_modules" ] || { say "installing $d dependencies…"; (cd "$ROOT/$d" && npm install --no-audit --no-fund); }; done

# --- PostgreSQL (project-local cluster, never touches the system instance on 5432) ---
PG_BIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)"
if listening $PG_PORT; then say "PostgreSQL already on :$PG_PORT"
else
  [ -n "$PG_BIN" ] || { echo "PostgreSQL server binaries not found (install postgresql)"; exit 1; }
  FRESH=0
  if [ ! -d "$LOCAL/pg" ]; then say "creating local PostgreSQL cluster…"; "$PG_BIN/initdb" -D "$LOCAL/pg" -U atlas --auth=trust >/dev/null; FRESH=1; fi
  "$PG_BIN/pg_ctl" -D "$LOCAL/pg" -o "-p $PG_PORT -k $LOCAL -c listen_addresses=127.0.0.1" -l "$LOCAL/pg.log" start >/dev/null
  for _ in $(seq 30); do listening $PG_PORT && break; sleep 0.5; done
  [ $FRESH = 1 ] && psql -h 127.0.0.1 -p $PG_PORT -U atlas -d postgres -qc "create database atlasone" >/dev/null
fi

export DATABASE_URL="postgresql://atlas@127.0.0.1:$PG_PORT/atlasone"
export MONGO_URL="mongodb://127.0.0.1:$MONGO_PORT/atlasone"
export LDAP_URL="ldap://127.0.0.1:$LDAP_PORT" LDAP_BASE_DN="dc=atlasone,dc=dev" LDAP_BIND_DN="cn=admin,dc=atlasone,dc=dev" LDAP_BIND_PASSWORD="admin"
export JWT_SECRET="${JWT_SECRET:-local-dev-secret}" INGEST_API_KEY="${INGEST_API_KEY:-nifi-dev-key}" PORT=$API_PORT REDIS_URL="" OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=""

# --- schema + demo data (first run only) ---
(cd "$ROOT/api" && npx prisma db push --skip-generate >/dev/null 2>&1 || npx prisma db push >/dev/null)
if [ "$(psql -h 127.0.0.1 -p $PG_PORT -U atlas atlasone -tAc 'select count(*) from "Company"')" = "0" ]; then say "seeding demo data…"; (cd "$ROOT/api" && npm run -s db:seed); fi

# --- MongoDB: 7.x needs AVX; older CPUs get 4.4 + bundled OpenSSL 1.1 ---
MONGO_ENV=()
if ! grep -qw avx /proc/cpuinfo; then
  SSL="$LOCAL/libssl1.1"
  if [ ! -f "$SSL/usr/lib/x86_64-linux-gnu/libcrypto.so.1.1" ]; then
    say "CPU has no AVX → using MongoDB 4.4; fetching OpenSSL 1.1 from the Ubuntu archive…"
    mkdir -p "$SSL"; curl -sfL -o "$SSL/libssl.deb" http://archive.ubuntu.com/ubuntu/pool/main/o/openssl/libssl1.1_1.1.1f-1ubuntu2_amd64.deb
    dpkg-deb -x "$SSL/libssl.deb" "$SSL"
  fi
  MONGO_ENV=(env "LD_LIBRARY_PATH=$SSL/usr/lib/x86_64-linux-gnu" MONGOMS_VERSION=4.4.29)
fi

CMDS=() NAMES=()
listening $MONGO_PORT && say "MongoDB already on :$MONGO_PORT" || { CMDS+=("${MONGO_ENV[*]} node scripts/dev-mongo.mjs $MONGO_PORT"); NAMES+=(mongo); }
listening $LDAP_PORT  && say "LDAP already on :$LDAP_PORT"     || { CMDS+=("LDAP_PORT=$LDAP_PORT node ../infra/ldap/dev-server.mjs"); NAMES+=(ldap); }
if listening $API_PORT; then say "API already on :$API_PORT"
else CMDS+=("bash -c 'until (exec 3<>/dev/tcp/127.0.0.1/$MONGO_PORT) 2>/dev/null && (exec 3<>/dev/tcp/127.0.0.1/$LDAP_PORT) 2>/dev/null; do sleep 1; done; exec npm run -s dev'"); NAMES+=(api); fi
listening $WEB_PORT   && say "Web already on :$WEB_PORT"       || { CMDS+=("cd ../web && npx vite --port $WEB_PORT --strictPort"); NAMES+=(web); }

say "open http://localhost:$WEB_PORT  ·  users: ceo, director, director.asia, manager, manager.pk, finance  ·  password: password"
say "API docs http://localhost:$API_PORT/api/docs  ·  Ctrl+C stops everything (PostgreSQL keeps running: npm run db:stop)"
[ ${#CMDS[@]} -eq 0 ] && { say "everything is already running"; exit 0; }
cd "$ROOT/api"
exec npx concurrently -k -n "$(IFS=,; echo "${NAMES[*]}")" -c "green,magenta,blue,cyan" "${CMDS[@]}"
