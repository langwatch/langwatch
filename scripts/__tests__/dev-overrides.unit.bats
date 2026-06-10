#!/usr/bin/env bats
# Unit tests for write_dev_overrides() in scripts/lib/write-dev-overrides.sh
# — the shared per-preset URL rewrite layer used by both `scripts/dev.sh`
# (quickstart presets) and `scripts/dev-up.sh` (per-worktree isolated
# stacks). Tests the helper directly to avoid coupling to either launcher's
# prompt logic.
#
# Hard invariant: credentials NEVER appear in the overlay. Only
# non-rotating infrastructure shape (bucket / endpoint / region /
# connection-host). Credentials live in langwatch/.env.

SCRIPT_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"

setup() {
  TEST_DIR="$(mktemp -d)"
  OUT="$TEST_DIR/.env.dev-up"
  source "$SCRIPT_DIR/lib/write-dev-overrides.sh"
}

teardown() {
  rm -rf "$TEST_DIR"
}

# --- preset validity ---

@test "unknown preset returns non-zero and prints the valid list" {
  run write_dev_overrides invalid-preset "$OUT"
  [ "$status" -ne 0 ]
  [[ "$output" == *"unknown preset 'invalid-preset'"* ]]
  [[ "$output" == *"all-local"* ]]
  [[ "$output" == *"dev-storage"* ]]
}

@test "empty preset name returns non-zero" {
  run write_dev_overrides "" "$OUT"
  [ "$status" -ne 0 ]
}

# --- all-local ---

# @scenario "all-local overrides only DATABASE_URL, REDIS_URL, CLICKHOUSE_URL"
@test "all-local rewrites DATABASE_URL, REDIS_URL, CLICKHOUSE_URL only" {
  write_dev_overrides all-local "$OUT"
  result=$(cat "$OUT")
  [[ "$result" == *"DATABASE_URL=postgresql://prisma:prisma@postgres:5432/mydb"* ]]
  [[ "$result" == *"REDIS_URL=redis://redis:6379"* ]]
  [[ "$result" == *"CLICKHOUSE_URL=http://default:langwatch@clickhouse:8123/langwatch"* ]]
  [[ "$result" != *"LANGWATCH_NLP_SERVICE"* ]]
  [[ "$result" != *"LANGEVALS_ENDPOINT"* ]]
  [[ "$result" != *"S3_BUCKET_NAME"* ]]
}

# --- all-local-nlp ---

# @scenario "all-local-nlp adds LANGWATCH_NLP_SERVICE and LANGEVALS_ENDPOINT on top of all-local"
@test "all-local-nlp adds LANGWATCH_NLP_SERVICE and LANGEVALS_ENDPOINT on top of all-local" {
  write_dev_overrides all-local-nlp "$OUT"
  result=$(cat "$OUT")
  [[ "$result" == *"DATABASE_URL=postgresql://prisma:prisma@postgres:5432"* ]]
  [[ "$result" == *"REDIS_URL=redis://redis:6379"* ]]
  [[ "$result" == *"CLICKHOUSE_URL=http://default:langwatch@clickhouse:8123"* ]]
  [[ "$result" == *"LANGWATCH_NLP_SERVICE=http://langwatch_nlp:5561"* ]]
  [[ "$result" == *"LANGEVALS_ENDPOINT=http://langevals:5562"* ]]
  [[ "$result" != *"S3_BUCKET_NAME"* ]]
}

# --- dev-storage ---

@test "dev-storage routes stored-objects to runtime-storage-dev (bucket+endpoint+region, no credentials)" {
  write_dev_overrides dev-storage "$OUT"
  result=$(cat "$OUT")
  [[ "$result" == *"DATABASE_URL=postgresql://prisma:prisma@postgres:5432"* ]]
  [[ "$result" == *"REDIS_URL=redis://redis:6379"* ]]
  [[ "$result" == *"CLICKHOUSE_URL=http://default:langwatch@clickhouse:8123"* ]]
  [[ "$result" == *"S3_BUCKET_NAME=runtime-storage-dev"* ]]
  [[ "$result" == *"S3_ENDPOINT=https://s3.eu-central-1.amazonaws.com"* ]]
  [[ "$result" == *"S3_REGION=eu-central-1"* ]]
}

@test "dev-storage overlay NEVER contains credentials (S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY / S3_SESSION_TOKEN)" {
  # Credentials always come from langwatch/.env (rotated by refresh-dev-s3-env.sh).
  # The overlay leaking them would be both a security regression and a source
  # of state-staleness bugs.
  write_dev_overrides dev-storage "$OUT"
  result=$(cat "$OUT")
  [[ "$result" != *"S3_ACCESS_KEY_ID"* ]]
  [[ "$result" != *"S3_SECRET_ACCESS_KEY"* ]]
  [[ "$result" != *"S3_SESSION_TOKEN"* ]]
}

@test "dev-storage does not start NLP containers" {
  write_dev_overrides dev-storage "$OUT"
  result=$(cat "$OUT")
  [[ "$result" != *"LANGWATCH_NLP_SERVICE"* ]]
  [[ "$result" != *"LANGEVALS_ENDPOINT"* ]]
}

# --- dev-infra ---

@test "dev-infra does NOT pin NEXTAUTH_PROVIDER (operator's .env decides OAuth vs email)" {
  # Shared dev Postgres already has OAuth users provisioned. Forcing
  # NEXTAUTH_PROVIDER=email in the overlay would prevent operators from
  # signing in as their existing OAuth identity. Leave the choice to .env.
  write_dev_overrides dev-infra "$OUT"
  result=$(cat "$OUT")
  [[ "$result" != *"NEXTAUTH_PROVIDER"* ]]
}

@test "dev-infra pins S3 shape (bucket+endpoint+region) so stored-objects route to dev S3" {
  # Without S3_BUCKET_NAME the destination resolver falls through to local
  # filesystem when LANGWATCH_LOCAL_STORAGE_PATH is set in .env. Pinning
  # the S3 shape forces resolveProjectStorageDestination to pick S3.
  write_dev_overrides dev-infra "$OUT"
  result=$(cat "$OUT")
  [[ "$result" == *"S3_BUCKET_NAME=runtime-storage-dev"* ]]
  [[ "$result" == *"S3_ENDPOINT=https://s3.eu-central-1.amazonaws.com"* ]]
  [[ "$result" == *"S3_REGION=eu-central-1"* ]]
}

@test "dev-infra pins REDIS_URL to localhost (local redis + workers containers, host-side pnpm dev)" {
  # The dev-infra launcher brings up the `redis` and `workers` compose
  # services so BullMQ jobs / GroupQueue streams stay isolated from other
  # operators on shared dev. The operator runs `pnpm dev` on the HOST (not
  # in docker), so this overlay's URL MUST be host-side localhost (not the
  # in-network `redis:6379` DNS name) — the host app reads this overlay.
  write_dev_overrides dev-infra "$OUT"
  result=$(cat "$OUT")
  [[ "$result" == *"REDIS_URL=redis://localhost:6379"* ]]
}

@test "dev-infra writes no DB / CH URL overrides (operator's .env points at shared dev)" {
  write_dev_overrides dev-infra "$OUT"
  result=$(cat "$OUT")
  [[ "$result" != *"DATABASE_URL"* ]]
  [[ "$result" != *"CLICKHOUSE_URL"* ]]
}

@test "dev-infra overlay NEVER contains S3 credentials" {
  # Credentials always come from langwatch/.env, rotated by
  # refresh-dev-s3-env.sh. Leaking them into the overlay would be both a
  # security regression and a source of state-staleness bugs.
  write_dev_overrides dev-infra "$OUT"
  result=$(cat "$OUT")
  [[ "$result" != *"S3_ACCESS_KEY_ID"* ]]
  [[ "$result" != *"S3_SECRET_ACCESS_KEY"* ]]
  [[ "$result" != *"S3_SESSION_TOKEN"* ]]
}

# --- frontend-only ---

# @scenario "frontend-only mode starts no compose containers"
@test "frontend-only writes only NEXTAUTH_PROVIDER (no compose, no URL overrides)" {
  write_dev_overrides frontend-only "$OUT"
  result=$(cat "$OUT")
  [[ "$result" == *"NEXTAUTH_PROVIDER=email"* ]]
  [[ "$result" != *"DATABASE_URL"* ]]
  [[ "$result" != *"REDIS_URL"* ]]
  [[ "$result" != *"CLICKHOUSE_URL"* ]]
  [[ "$result" != *"LANGWATCH_NLP_SERVICE"* ]]
}

# --- migration ---

# @scenario "migration uses localhost host-port URLs for prisma migrate from host"
@test "migration uses localhost host-port URLs (not docker-network names)" {
  # postgres + clickhouse exposed on the host so `pnpm prisma migrate` from
  # the host can reach them. Redis isn't started, so no REDIS_URL override.
  write_dev_overrides migration "$OUT"
  result=$(cat "$OUT")
  [[ "$result" == *"DATABASE_URL=postgresql://prisma:prisma@localhost:5432/mydb"* ]]
  [[ "$result" == *"CLICKHOUSE_URL=http://default:langwatch@localhost:8123/langwatch"* ]]
  [[ "$result" != *"REDIS_URL"* ]]
  [[ "$result" != *"S3_BUCKET_NAME"* ]]
}

# --- full-local ---

# @scenario "full-local overrides every infrastructure URL"
@test "full-local writes all five infrastructure URLs" {
  write_dev_overrides full-local "$OUT"
  result=$(cat "$OUT")
  [[ "$result" == *"DATABASE_URL"* ]]
  [[ "$result" == *"REDIS_URL"* ]]
  [[ "$result" == *"CLICKHOUSE_URL"* ]]
  [[ "$result" == *"LANGWATCH_NLP_SERVICE"* ]]
  [[ "$result" == *"LANGEVALS_ENDPOINT"* ]]
}

@test "full-local does not add storage env vars (uses local-FS fallback)" {
  write_dev_overrides full-local "$OUT"
  result=$(cat "$OUT")
  [[ "$result" != *"S3_BUCKET_NAME"* ]]
}

# --- idempotency ---

# @scenario "write_overrides replaces langwatch/.env.dev-up — does not append"
@test "second call replaces (not appends) the overlay file" {
  write_dev_overrides all-local "$OUT"
  write_dev_overrides frontend-only "$OUT"
  result=$(cat "$OUT")
  [[ "$result" != *"DATABASE_URL"* ]]
  [[ "$result" == *"NEXTAUTH_PROVIDER=email"* ]]
}

# --- credential-leak invariant across all presets ---

@test "no preset writes any credential-shaped env var to the overlay" {
  # Cross-preset paranoia check. The contract is: only non-rotating infra
  # shape goes in the overlay. If a new preset is added later that violates
  # this, this test catches it before it ships.
  for preset in all-local all-local-nlp dev-storage dev-infra frontend-only migration full-local; do
    write_dev_overrides "$preset" "$OUT"
    result=$(cat "$OUT")
    [[ "$result" != *"ACCESS_KEY"* ]] || { echo "preset=$preset leaked ACCESS_KEY"; false; }
    [[ "$result" != *"SECRET_ACCESS_KEY"* ]] || { echo "preset=$preset leaked SECRET_ACCESS_KEY"; false; }
    [[ "$result" != *"SESSION_TOKEN"* ]] || { echo "preset=$preset leaked SESSION_TOKEN"; false; }
    [[ "$result" != *"AZURE_BLOB_ACCOUNT_KEY"* ]] || { echo "preset=$preset leaked AZURE_BLOB_ACCOUNT_KEY"; false; }
    [[ "$result" != *"_PASSWORD"* ]] || { echo "preset=$preset leaked _PASSWORD"; false; }
  done
}
