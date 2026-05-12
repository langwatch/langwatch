#!/usr/bin/env bats
# Unit tests for scripts/boxd/create-golden.sh pure functions.

SCRIPT_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"

setup() {
  source "$SCRIPT_DIR/boxd/create-golden.sh"
  # Deterministic stub: every call returns a different counter, so we can
  # verify each PLACEHOLDER_REGENERATE_ME got its own value.
  STUB_COUNTER=0
  generate_secret() {
    STUB_COUNTER=$((STUB_COUNTER + 1))
    printf 'secret-%d' "$STUB_COUNTER"
  }
}

# --- derive_hostname ---

@test "derive_hostname: appends .boxd.sh to a name" {
  result=$(derive_hostname "langwatch-main")
  [ "$result" = "langwatch-main.boxd.sh" ]
}

@test "derive_hostname: handles personal-suffix names" {
  result=$(derive_hostname "langwatch-main-alice")
  [ "$result" = "langwatch-main-alice.boxd.sh" ]
}

# --- render_env ---

@test "render_env: substitutes BOXD_HOST" {
  result=$(printf 'BASE_HOST="https://${BOXD_HOST}"\n' | render_env "lw.boxd.sh")
  [ "$result" = 'BASE_HOST="https://lw.boxd.sh"' ]
}

@test "render_env: substitutes BOXD_HOST multiple times on different lines" {
  input=$'BASE_HOST="https://${BOXD_HOST}"\nNEXTAUTH_URL="https://${BOXD_HOST}"'
  result=$(printf '%s\n' "$input" | render_env "lw.boxd.sh")
  expected=$'BASE_HOST="https://lw.boxd.sh"\nNEXTAUTH_URL="https://lw.boxd.sh"'
  [ "$result" = "$expected" ]
}

@test "render_env: replaces each PLACEHOLDER_REGENERATE_ME with a fresh secret" {
  input=$'NEXTAUTH_SECRET="PLACEHOLDER_REGENERATE_ME"\nCREDENTIALS_SECRET="PLACEHOLDER_REGENERATE_ME"'
  result=$(printf '%s\n' "$input" | render_env "lw.boxd.sh")
  # Each line should have a different stub value (secret-1, secret-2)
  [[ "$result" == *'NEXTAUTH_SECRET="secret-1"'* ]]
  [[ "$result" == *'CREDENTIALS_SECRET="secret-2"'* ]]
  # No placeholder left behind
  [[ "$result" != *PLACEHOLDER_REGENERATE_ME* ]]
}

@test "render_env: leaves lines with neither token unchanged" {
  result=$(printf 'NODE_ENV="development"\n' | render_env "lw.boxd.sh")
  [ "$result" = 'NODE_ENV="development"' ]
}

@test "render_env: leaves empty values empty (no fake placeholder)" {
  # This guards against the #3203 regression: a fake string like
  # "your-key-here" would 401 against the upstream LLM provider.
  result=$(printf 'OPENAI_API_KEY=\n' | render_env "lw.boxd.sh")
  [ "$result" = 'OPENAI_API_KEY=' ]
}

@test "render_env: real template renders with no placeholders remaining" {
  template_path="$SCRIPT_DIR/boxd/.env.golden.template"
  result=$(render_env "lw.boxd.sh" < "$template_path")
  [[ "$result" != *PLACEHOLDER_REGENERATE_ME* ]]
  [[ "$result" != *'${BOXD_HOST}'* ]]
  # Sanity: critical vars are present and rendered
  [[ "$result" == *'BASE_HOST="https://lw.boxd.sh"'* ]]
  [[ "$result" == *'NEXTAUTH_URL="https://lw.boxd.sh"'* ]]
  [[ "$result" == *'LANGWATCH_ENDPOINT="https://lw.boxd.sh"'* ]]
}
