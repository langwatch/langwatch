#!/usr/bin/env bats
# Unit tests for langwatch/scripts/ensure-ai-gateway-secrets.sh — guards
# issue #3902 (fresh `make dev` crashloops because the env validator
# requires three >=32-char AI Gateway secrets that ship empty in
# .env.example).

SCRIPT_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
SCRIPT="$SCRIPT_DIR/ensure-ai-gateway-secrets.sh"

setup() {
  TEST_DIR="$(mktemp -d)"
  # The script resolves $ENV_FILE via dirname(self)/../.env, so we copy it
  # into a fixture tree that mirrors the langwatch/scripts/ layout.
  mkdir -p "$TEST_DIR/scripts"
  cp "$SCRIPT" "$TEST_DIR/scripts/ensure-ai-gateway-secrets.sh"
  ENV_FILE="$TEST_DIR/.env"
}

teardown() {
  rm -rf "$TEST_DIR"
}

@test "exits 0 cleanly when langwatch/.env does not exist" {
  run bash "$TEST_DIR/scripts/ensure-ai-gateway-secrets.sh"
  [ "$status" -eq 0 ]
  [ ! -f "$ENV_FILE" ]
}

@test "appends all three secrets when .env has none of them" {
  cat > "$ENV_FILE" <<EOF
SOMETHING_ELSE=keep-me
EOF
  run bash "$TEST_DIR/scripts/ensure-ai-gateway-secrets.sh"
  [ "$status" -eq 0 ]
  grep -qE "^LW_GATEWAY_INTERNAL_SECRET=[0-9a-f]{64}$" "$ENV_FILE"
  grep -qE "^LW_GATEWAY_JWT_SECRET=[0-9a-f]{64}$"      "$ENV_FILE"
  grep -qE "^LW_VIRTUAL_KEY_PEPPER=[0-9a-f]{64}$"      "$ENV_FILE"
  # Existing content preserved.
  grep -q "^SOMETHING_ELSE=keep-me$" "$ENV_FILE"
}

@test "fills in empty assignments without overwriting non-empty ones" {
  cat > "$ENV_FILE" <<EOF
LW_GATEWAY_INTERNAL_SECRET=
LW_GATEWAY_JWT_SECRET=already-set-by-developer-do-not-touch-this-please
LW_VIRTUAL_KEY_PEPPER=
EOF
  run bash "$TEST_DIR/scripts/ensure-ai-gateway-secrets.sh"
  [ "$status" -eq 0 ]
  grep -qE "^LW_GATEWAY_INTERNAL_SECRET=[0-9a-f]{64}$" "$ENV_FILE"
  grep -qE "^LW_VIRTUAL_KEY_PEPPER=[0-9a-f]{64}$"      "$ENV_FILE"
  # Pre-existing non-empty value MUST NOT be touched.
  grep -q "^LW_GATEWAY_JWT_SECRET=already-set-by-developer-do-not-touch-this-please$" "$ENV_FILE"
}

@test "is idempotent — second run generates nothing and changes no values" {
  cat > "$ENV_FILE" <<EOF
SOMETHING_ELSE=keep-me
EOF
  bash "$TEST_DIR/scripts/ensure-ai-gateway-secrets.sh" >/dev/null
  cp "$ENV_FILE" "$TEST_DIR/.env.snapshot"
  run bash "$TEST_DIR/scripts/ensure-ai-gateway-secrets.sh"
  [ "$status" -eq 0 ]
  diff "$ENV_FILE" "$TEST_DIR/.env.snapshot"
  # Output should not announce any new generation on the second pass.
  [[ "$output" != *"generated"* ]]
}

@test "handles quoted empty values" {
  cat > "$ENV_FILE" <<EOF
LW_GATEWAY_INTERNAL_SECRET=""
LW_GATEWAY_JWT_SECRET=''
LW_VIRTUAL_KEY_PEPPER=
EOF
  run bash "$TEST_DIR/scripts/ensure-ai-gateway-secrets.sh"
  [ "$status" -eq 0 ]
  grep -qE "^LW_GATEWAY_INTERNAL_SECRET=[0-9a-f]{64}$" "$ENV_FILE"
  grep -qE "^LW_GATEWAY_JWT_SECRET=[0-9a-f]{64}$"      "$ENV_FILE"
  grep -qE "^LW_VIRTUAL_KEY_PEPPER=[0-9a-f]{64}$"      "$ENV_FILE"
}
