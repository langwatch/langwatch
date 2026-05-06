#!/usr/bin/env bats
# Unit tests for write_overrides() in scripts/dev.sh — the per-mode URL
# rewrite layer that backs `make quickstart <mode>` (#3860 AC#2 / AC#6).

SCRIPT_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

setup() {
  TEST_DIR="$(mktemp -d)"
  mkdir -p "$TEST_DIR/langwatch"
  pushd "$TEST_DIR" > /dev/null
  source "$SCRIPT_DIR/dev.sh"
}

teardown() {
  popd > /dev/null
  rm -rf "$TEST_DIR"
}

@test "frontend-only writes only NEXTAUTH_PROVIDER (no infra URL overrides)" {
  write_overrides frontend-only > /dev/null 2>&1
  result=$(cat langwatch/.env.dev-up)
  [[ "$result" == *"NEXTAUTH_PROVIDER=email"* ]]
  [[ "$result" != *"DATABASE_URL"* ]]
  [[ "$result" != *"REDIS_URL"* ]]
  [[ "$result" != *"CLICKHOUSE_URL"* ]]
  [[ "$result" != *"LANGWATCH_NLP_SERVICE"* ]]
}

@test "backend-shared rewrites DATABASE_URL, REDIS_URL, CLICKHOUSE_URL" {
  write_overrides backend-shared > /dev/null 2>&1
  result=$(cat langwatch/.env.dev-up)
  [[ "$result" == *"DATABASE_URL=postgresql://prisma:prisma@postgres:5432/mydb"* ]]
  [[ "$result" == *"REDIS_URL=redis://redis:6379"* ]]
  [[ "$result" == *"CLICKHOUSE_URL=http://default:langwatch@clickhouse:8123/langwatch"* ]]
  [[ "$result" != *"LANGWATCH_NLP_SERVICE"* ]]
  [[ "$result" != *"LANGEVALS_ENDPOINT"* ]]
}

@test "migration uses localhost host-port URLs (not docker-network names)" {
  write_overrides migration > /dev/null 2>&1
  result=$(cat langwatch/.env.dev-up)
  [[ "$result" == *"DATABASE_URL=postgresql://prisma:prisma@localhost:5432/mydb"* ]]
  [[ "$result" == *"CLICKHOUSE_URL=http://default:langwatch@localhost:8123/langwatch"* ]]
  [[ "$result" != *"REDIS_URL"* ]]
}

@test "nlp adds LANGWATCH_NLP_SERVICE and LANGEVALS_ENDPOINT on top of backend" {
  write_overrides nlp > /dev/null 2>&1
  result=$(cat langwatch/.env.dev-up)
  [[ "$result" == *"DATABASE_URL=postgresql://prisma:prisma@postgres:5432"* ]]
  [[ "$result" == *"REDIS_URL=redis://redis:6379"* ]]
  [[ "$result" == *"CLICKHOUSE_URL=http://default:langwatch@clickhouse:8123"* ]]
  [[ "$result" == *"LANGWATCH_NLP_SERVICE=http://langwatch_nlp:5561"* ]]
  [[ "$result" == *"LANGEVALS_ENDPOINT=http://langevals:5562"* ]]
}

@test "full-local writes the same set as nlp (everything local)" {
  write_overrides full-local > /dev/null 2>&1
  result=$(cat langwatch/.env.dev-up)
  [[ "$result" == *"DATABASE_URL"* ]]
  [[ "$result" == *"REDIS_URL"* ]]
  [[ "$result" == *"CLICKHOUSE_URL"* ]]
  [[ "$result" == *"LANGWATCH_NLP_SERVICE"* ]]
  [[ "$result" == *"LANGEVALS_ENDPOINT"* ]]
}

@test "write_overrides is idempotent — second call replaces, not appends" {
  write_overrides backend-shared > /dev/null 2>&1
  write_overrides frontend-only > /dev/null 2>&1
  result=$(cat langwatch/.env.dev-up)
  [[ "$result" != *"DATABASE_URL"* ]]
  [[ "$result" == *"NEXTAUTH_PROVIDER=email"* ]]
}
