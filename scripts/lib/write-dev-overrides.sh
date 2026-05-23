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
#   all-local-nlp     all-local + langwatch_nlp + langevals containers.
#                     For NLP-touching work.
#   dev-storage       Local CH+PG+Redis, NLP off, stored-objects -> dev S3
#                     (runtime-storage-dev in lw-dev). Real AWS S3 driver
#                     under test; CH/PG stay local so you don't pollute
#                     shared dev tables.
#   dev-infra         Everything against shared dev infrastructure
#                     (dev CH, dev PG, dev Redis, dev S3, dev NLP). Most
#                     faithful e2e; other developers see your data.
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

  # Always-on: dev uses email auth (no Auth0 dependency).
  echo "NEXTAUTH_PROVIDER=email" >> "$out"

  case "$preset" in
    frontend-only)
      # No compose. Operator's .env points at dev infra; no overrides needed.
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
      # Everything against dev infrastructure. The overlay leaves all URLs
      # alone — they come from .env, which is presumed to be pointed at
      # shared dev. Storage routing is similarly .env-driven. Auth still
      # forced to email for predictable local sign-in.
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
