#!/usr/bin/env bats
# Unit tests for write_dev_overrides() in scripts/lib/write-dev-overrides.sh
# — the shared per-mode URL rewrite layer used by both `scripts/dev.sh`
# (intent-based modes) and `scripts/dev-up.sh` (legacy compose-profile
# names) (#3860 AC#2 / AC#6). Tests the helper directly to avoid coupling
# to either launcher's prompt logic.

SCRIPT_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"

setup() {
  TEST_DIR="$(mktemp -d)"
  OUT="$TEST_DIR/.env.dev-up"
  source "$SCRIPT_DIR/lib/write-dev-overrides.sh"
}

teardown() {
  rm -rf "$TEST_DIR"
}

# --- intent-based mode names (scripts/dev.sh) ---

@test "frontend-only writes only NEXTAUTH_PROVIDER (no infra URL overrides)" {
  write_dev_overrides frontend-only "$OUT"
  result=$(cat "$OUT")
  [[ "$result" == *"NEXTAUTH_PROVIDER=email"* ]]
  [[ "$result" != *"DATABASE_URL"* ]]
  [[ "$result" != *"REDIS_URL"* ]]
  [[ "$result" != *"CLICKHOUSE_URL"* ]]
  [[ "$result" != *"LANGWATCH_NLP_SERVICE"* ]]
}

@test "backend-shared rewrites DATABASE_URL, REDIS_URL, CLICKHOUSE_URL only" {
  write_dev_overrides backend-shared "$OUT"
  result=$(cat "$OUT")
  [[ "$result" == *"DATABASE_URL=postgresql://prisma:prisma@postgres:5432/mydb"* ]]
  [[ "$result" == *"REDIS_URL=redis://redis:6379"* ]]
  [[ "$result" == *"CLICKHOUSE_URL=http://default:langwatch@clickhouse:8123/langwatch"* ]]
  [[ "$result" != *"LANGWATCH_NLP_SERVICE"* ]]
  [[ "$result" != *"LANGEVALS_ENDPOINT"* ]]
}

@test "migration uses localhost host-port URLs (not docker-network names)" {
  write_dev_overrides migration "$OUT"
  result=$(cat "$OUT")
  [[ "$result" == *"DATABASE_URL=postgresql://prisma:prisma@localhost:5432/mydb"* ]]
  [[ "$result" == *"CLICKHOUSE_URL=http://default:langwatch@localhost:8123/langwatch"* ]]
  [[ "$result" != *"REDIS_URL"* ]]
}

@test "nlp adds LANGWATCH_NLP_SERVICE and LANGEVALS_ENDPOINT on top of backend" {
  write_dev_overrides nlp "$OUT"
  result=$(cat "$OUT")
  [[ "$result" == *"DATABASE_URL=postgresql://prisma:prisma@postgres:5432"* ]]
  [[ "$result" == *"REDIS_URL=redis://redis:6379"* ]]
  [[ "$result" == *"CLICKHOUSE_URL=http://default:langwatch@clickhouse:8123"* ]]
  [[ "$result" == *"LANGWATCH_NLP_SERVICE=http://langwatch_nlp:5561"* ]]
  [[ "$result" == *"LANGEVALS_ENDPOINT=http://langevals:5562"* ]]
}

@test "full-local writes all five infrastructure URLs" {
  write_dev_overrides full-local "$OUT"
  result=$(cat "$OUT")
  [[ "$result" == *"DATABASE_URL"* ]]
  [[ "$result" == *"REDIS_URL"* ]]
  [[ "$result" == *"CLICKHOUSE_URL"* ]]
  [[ "$result" == *"LANGWATCH_NLP_SERVICE"* ]]
  [[ "$result" == *"LANGEVALS_ENDPOINT"* ]]
}

@test "second call replaces (not appends) langwatch/.env.dev-up" {
  write_dev_overrides backend-shared "$OUT"
  write_dev_overrides frontend-only "$OUT"
  result=$(cat "$OUT")
  [[ "$result" != *"DATABASE_URL"* ]]
  [[ "$result" == *"NEXTAUTH_PROVIDER=email"* ]]
}

# --- compose-profile mode names (scripts/dev-up.sh) — service-membership rules ---

@test "scenarios profile starts langwatch_nlp but NOT langevals — overlay must respect" {
  # langwatch_nlp is in [nlp, scenarios, full]; langevals is [nlp, full].
  # scripts/dev-up.sh PROFILE=scenarios was previously writing both, leaving
  # LANGEVALS_ENDPOINT pointing at a non-existent container.
  write_dev_overrides scenarios "$OUT"
  result=$(cat "$OUT")
  [[ "$result" == *"LANGWATCH_NLP_SERVICE=http://langwatch_nlp:5561"* ]]
  [[ "$result" != *"LANGEVALS_ENDPOINT"* ]]
}

@test "test profile adds no NLP / langevals URLs (ai-server only)" {
  write_dev_overrides test "$OUT"
  result=$(cat "$OUT")
  [[ "$result" != *"LANGWATCH_NLP_SERVICE"* ]]
  [[ "$result" != *"LANGEVALS_ENDPOINT"* ]]
  # Does still set the always-on backend URLs.
  [[ "$result" == *"DATABASE_URL"* ]]
}

@test "full profile (legacy name) sets both NLP and langevals URLs" {
  write_dev_overrides full "$OUT"
  result=$(cat "$OUT")
  [[ "$result" == *"LANGWATCH_NLP_SERVICE"* ]]
  [[ "$result" == *"LANGEVALS_ENDPOINT"* ]]
}

@test "workers profile starts langwatch_nlp (no langevals)" {
  write_dev_overrides workers "$OUT"
  result=$(cat "$OUT")
  [[ "$result" == *"LANGWATCH_NLP_SERVICE"* ]]
  [[ "$result" != *"LANGEVALS_ENDPOINT"* ]]
}
