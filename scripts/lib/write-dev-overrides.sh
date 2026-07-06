#!/bin/bash
# Shared write_overrides helper.
#
# Writes `langwatch/.env.dev-up` listing ONLY the URLs whose services
# starting locally for the given preset. Compose loads the overlay AFTER
# `langwatch/.env`, so non-overridden URLs keep their .env values — the
# contributor's `.env` is the source of truth.
#
# Credentials NEVER go in the overlay (only non-rotating infrastructure
# shape: bucket/endpoint/region/connection-host). Credentials live in
# `.env`, refreshed by the operator (see langwatch/scripts/refresh-dev-s3-env.sh
# for the SSO/STS workflow).
#
# Presets (passed as $1):
#   all-local         Local CH+PG+Redis, no NLP, local-FS for stored-objects.
#                     The fast-iteration default.
#   all-local-nlp     all-local + nlpgo (Go NLP engine) + langevals containers.
#                     For NLP-touching work.
#   dev-storage       Local CH+PG+Redis, NLP off, stored-objects -> dev S3
#                     (runtime-storage-dev in lw-dev). Real AWS S3 driver
#                     under test; CH/PG stay local so you don't pollute
#                     shared dev tables.
#   dev-infra         Local Redis + remote shared-dev for everything else
#                     (dev CH, dev PG, dev S3, dev NLP). Redis is local so
#                     BullMQ jobs / GroupQueue streams stay isolated to this
#                     operator (using shared dev Redis would collide with
#                     other developers' jobs). Most faithful e2e short of
#                     prod; other developers see your CH / PG writes.
#   frontend-only     No compose. Everything from .env, which is presumed
#                     to point at shared dev infra. UI work only.
#   migration         CH+PG on HOST ports (5432 / 8123) so prisma migrate
#                     can run from host. No app, no Redis, no NLP, no S3.
#   full-local        all-local + workers + bullboard + ai-server + NLP +
#                     langevals. Kitchen-sink local dev.

write_dev_overrides() {
  local preset="${1-}"
  local out="${2:-langwatch/.env.dev-up}"

  case "$preset" in
    all-local|all-local-nlp|dev-storage|dev-infra|frontend-only|migration|full-local) ;;
    *)
      echo "write_dev_overrides: unknown preset '$preset'" >&2
      echo "  valid: all-local, all-local-nlp, dev-storage, dev-infra, frontend-only, migration, full-local" >&2
      return 1
      ;;
  esac

  : > "$out"

  # NEXTAUTH_PROVIDER is preset-specific: local-only presets force email
  # (no Auth0 / OAuth dependency for offline iteration), but dev-infra
  # leaves auth to the operator's .env so they can log in as an existing
  # OAuth user already provisioned in shared dev Postgres.
  case "$preset" in
    dev-infra) ;;
    *) echo "NEXTAUTH_PROVIDER=email" >> "$out" ;;
  esac

  case "$preset" in
    frontend-only)
      # No app/DB/CH compose — DB / CH / NLP / S3 all come from the operator's
      # .env (shared dev). The one exception is Redis: `pnpm dev` runs the
      # BullMQ workers in-process by default, and the dev.sh launcher brings up
      # a local `redis` compose service for them (sharing dev Redis would
      # collide with other developers' jobs — same reasoning as dev-infra).
      # Pin REDIS_URL to host-side localhost because `pnpm dev` runs on the
      # HOST, not inside the docker network.
      cat >> "$out" <<'EOF'
REDIS_URL=redis://localhost:6379
EOF
      return 0
      ;;
    migration)
      # postgres + clickhouse on HOST ports for `pnpm prisma migrate` from host.
      cat >> "$out" <<'EOF'
DATABASE_URL=postgresql://prisma:prisma@localhost:5432/mydb?schema=mydb
CLICKHOUSE_URL=http://default:langwatch@localhost:8123/langwatch
EOF
      return 0
      ;;
    dev-infra)
      # DB / CH / NLP URLs come from the operator's .env (pointed at shared
      # dev). Two things MUST be pinned in the overlay:
      #
      # 1. REDIS_URL=redis://localhost:6379 — the dev-infra launcher brings
      #    up the `redis` compose service on host port 6379. The operator
      #    runs `pnpm dev` on the HOST (not inside the docker network), so
      #    the URL must be the host-side localhost, NOT the in-network
      #    `redis:6379` DNS name. Local Redis keeps BullMQ / GroupQueue
      #    isolated to this operator; sharing dev Redis would collide with
      #    other developers' jobs.
      # 2. S3 shape (bucket / endpoint / region) — without an explicit
      #    S3_BUCKET_NAME the destination resolver
      #    (project-storage-destination.ts) falls through to local
      #    filesystem whenever LANGWATCH_LOCAL_STORAGE_PATH is set in .env.
      #    Pin the S3 shape so dev-infra matches dev-storage's routing.
      #    Credentials still come from .env (refreshed via
      #    refresh-dev-s3-env.sh).
      cat >> "$out" <<'EOF'
REDIS_URL=redis://localhost:6379
S3_BUCKET_NAME=runtime-storage-dev
S3_ENDPOINT=https://s3.eu-central-1.amazonaws.com
S3_REGION=eu-central-1
EOF
      return 0
      ;;
  esac

  # Remaining presets all run the default compose profile (local CH+PG+Redis+app).
  cat >> "$out" <<'EOF'
DATABASE_URL=postgresql://prisma:prisma@postgres:5432/mydb?schema=mydb
REDIS_URL=redis://redis:6379
CLICKHOUSE_URL=http://default:langwatch@clickhouse:8123/langwatch
EOF

  # NLP / langevals overrides depend on which containers actually start.
  case "$preset" in
    all-local-nlp|full-local)
      echo "LANGWATCH_NLP_SERVICE=http://langwatch_nlp:5561" >> "$out"
      echo "LANGEVALS_ENDPOINT=http://langevals:5562" >> "$out"
      ;;
  esac

  # dev-storage routes stored-objects to dev S3 while keeping CH/PG/Redis
  # local. ONLY non-rotating infra shape goes in the overlay (bucket /
  # endpoint / region). Credentials (S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY,
  # S3_SESSION_TOKEN) must already be in `.env` — operator runs
  # `bash langwatch/scripts/refresh-dev-s3-env.sh` when the SSO session
  # expires (~hourly). The launcher checks for stale creds before starting.
  case "$preset" in
    dev-storage)
      cat >> "$out" <<'EOF'
S3_BUCKET_NAME=runtime-storage-dev
S3_ENDPOINT=https://s3.eu-central-1.amazonaws.com
S3_REGION=eu-central-1
EOF
      ;;
  esac
}
