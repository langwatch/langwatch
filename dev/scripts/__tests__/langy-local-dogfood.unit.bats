#!/usr/bin/env bats
# Unit tests for dev/scripts/dogfood/langy-local.sh, the Langy local dogfood
# doctor. The script under test runs for real against a sandboxed repo
# layout: a temp platform/app/.env, a fake go shim on PATH, and real
# loopback listeners standing in for the app / gateway / langyagent.
#
# Spec: specs/setup/langy-local-dogfood.feature

REPO_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")/../../.." && pwd)"

setup() {
  TEST_DIR="$(mktemp -d)"
  mkdir -p "$TEST_DIR/dev/scripts/dogfood" "$TEST_DIR/platform/app" "$TEST_DIR/bin"
  cp "$REPO_DIR/dev/scripts/dogfood/langy-local.sh" "$TEST_DIR/dev/scripts/dogfood/"
  DOCTOR="$TEST_DIR/dev/scripts/dogfood/langy-local.sh"
  ENV_FILE="$TEST_DIR/platform/app/.env"
  : >"$ENV_FILE"

  # Binaries the doctor requires: a fake shim is enough — it only checks PATH.
  printf '#!/bin/sh\nexit 0\n' >"$TEST_DIR/bin/go"
  chmod +x "$TEST_DIR/bin/go"

  # A base port slot unlikely to collide; the doctor derives gateway = base+3.
  BASE_PORT=$((20000 + (RANDOM % 20000)))
  AGENT_PORT=$((BASE_PORT + 7))
  LISTENER_PIDS=()
}

teardown() {
  for pid in "${LISTENER_PIDS[@]}"; do kill "$pid" 2>/dev/null || true; done
  rm -rf "$TEST_DIR"
}

listen_on() {
  python3 -m http.server "$1" --bind 127.0.0.1 >/dev/null 2>&1 &
  LISTENER_PIDS+=("$!")
  for _ in $(seq 1 50); do
    if lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; then return 0; fi
    sleep 0.1
  done
  return 1
}

write_full_env() {
  mkdir -p "$TEST_DIR/sessions" "$TEST_DIR/workspace"
  cat >"$ENV_FILE" <<EOF
LANGY_AGENT_URL="http://localhost:${AGENT_PORT}"
LANGY_INTERNAL_SECRET="test-secret"
LANGY_UNSAFE_DEV_DISABLE_ISOLATION=true
SESSIONS_ROOT="$TEST_DIR/sessions"
LANGY_WORKSPACE_ROOT="$TEST_DIR/workspace"
FEATURE_FLAG_FORCE_ENABLE=release_langy_enabled
EOF
}

run_doctor() {
  PATH="$TEST_DIR/bin:$PATH" PORT="$BASE_PORT" LANGY_AGENT_PORT="$AGENT_PORT" run "$DOCTOR" "$@"
}

# @scenario "A fully wired setup passes every check"
@test "fully wired setup passes every check and exits zero" {
  write_full_env
  listen_on "$BASE_PORT"
  listen_on $((BASE_PORT + 3))
  listen_on "$AGENT_PORT"

  run_doctor
  [ "$status" -eq 0 ]
  [[ "$output" == *"all checks passed"* ]]
  [[ "$output" == *"http://localhost:${BASE_PORT}"* ]]
  [[ "$output" != *"✗"* ]]
}

# @scenario "A missing env entry prints the exact lines to add"
@test "missing env entries are named with a ready-to-paste block and non-zero exit" {
  run_doctor
  [ "$status" -ne 0 ]
  [[ "$output" == *"LANGY_INTERNAL_SECRET missing"* ]]
  [[ "$output" == *"LANGY_AGENT_URL missing"* ]]
  [[ "$output" == *'LANGY_UNSAFE_DEV_DISABLE_ISOLATION=true'* ]]
  [[ "$output" == *"LANGY_INTERNAL_SECRET=\""* ]]
}

# @scenario "A dead service prints the command that starts it"
@test "a dead langyagent names the service and prints its start command" {
  write_full_env
  listen_on "$BASE_PORT"
  listen_on $((BASE_PORT + 3))

  run_doctor
  [ "$status" -ne 0 ]
  [[ "$output" == *"langyagent not listening on :${AGENT_PORT}"* ]]
  [[ "$output" == *"service svc=langyagent"* ]]
}

# @scenario "A provider key that the provider rejects is caught before a turn wastes time on it"
@test "a rejected provider key is reported without failing an otherwise green doctor" {
  write_full_env
  echo 'OPENAI_API_KEY="sk-proj-dead"' >>"$ENV_FILE"
  listen_on "$BASE_PORT"
  listen_on $((BASE_PORT + 3))
  listen_on "$AGENT_PORT"

  # A local responder that rejects everything, standing in for the provider.
  REJECT_PORT=$((BASE_PORT + 11))
  python3 -c '
import http.server, sys
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(401); self.end_headers()
    def log_message(self, *a): pass
http.server.HTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()
' "$REJECT_PORT" &
  LISTENER_PIDS+=("$!")
  for _ in $(seq 1 50); do
    lsof -nP -iTCP:"$REJECT_PORT" -sTCP:LISTEN >/dev/null 2>&1 && break
    sleep 0.1
  done

  PATH="$TEST_DIR/bin:$PATH" PORT="$BASE_PORT" LANGY_AGENT_PORT="$AGENT_PORT" \
    LANGY_DOCTOR_OPENAI_URL="http://127.0.0.1:${REJECT_PORT}/v1/models" \
    run "$DOCTOR"
  [ "$status" -eq 0 ]
  [[ "$output" == *"OPENAI_API_KEY REJECTED by the provider (HTTP 401)"* ]]
  [[ "$output" == *"all checks passed"* ]]

  # A userinfo-tricked override (http://localhost:...@attacker) must be
  # rejected: the key would otherwise be sent off-machine. curl is stubbed to
  # record its argv (no network), so the assertion is that the doctor handed
  # curl the REAL fallback endpoint, never the attacker authority.
  mkdir -p "$TEST_DIR/curlstub"
  cat >"$TEST_DIR/curlstub/curl" <<STUB
#!/bin/sh
printf '%s\n' "\$@" >>"$TEST_DIR/curl-args"
cat >/dev/null
printf '000'
STUB
  chmod +x "$TEST_DIR/curlstub/curl"
  PATH="$TEST_DIR/curlstub:$TEST_DIR/bin:$PATH" PORT="$BASE_PORT" LANGY_AGENT_PORT="$AGENT_PORT" \
    LANGY_DOCTOR_OPENAI_URL="http://localhost:${REJECT_PORT}@attacker.example/v1/models" \
    run "$DOCTOR"
  [[ "$output" == *"ignoring non-loopback endpoint override"* ]]
  grep -q "https://api.openai.com/v1/models" "$TEST_DIR/curl-args"
  ! grep -q "attacker.example" "$TEST_DIR/curl-args"
}
