#!/usr/bin/env bats
# Unit tests for langwatch/scripts/lib/go-service-autostart.sh — the
# start-or-skip decision and nlpgo bind-port resolution that drive pnpm dev's
# bundled Go service auto-start.
# See specs/setup/pnpm-dev-process-autostart.feature.

HELPER="$(cd "$(dirname "$BATS_TEST_FILENAME")/../lib" && pwd)/go-service-autostart.sh"

setup() {
  FAKEBIN="$(mktemp -d)"
  # Fake lsof: exit 0 (port in use) when FAKE_LSOF_INUSE=1, else exit 1 (free).
  # Absolute shebang so it still execs when PATH is pinned to the fake bin.
  cat > "$FAKEBIN/lsof" <<'EOF'
#!/bin/bash
[ "$FAKE_LSOF_INUSE" = "1" ] && exit 0 || exit 1
EOF
  chmod +x "$FAKEBIN/lsof"
}

teardown() {
  rm -rf "$FAKEBIN"
}

# Make `go` resolvable on the fake PATH for the present-toolchain cases.
with_go() {
  cat > "$FAKEBIN/go" <<'EOF'
#!/bin/bash
exit 0
EOF
  chmod +x "$FAKEBIN/go"
}

# Run the decision with PATH pinned to the fake bin so `command -v go` and
# `lsof` resolve to our fakes, never the host toolchain. bash itself is still
# found via the real PATH before we override it inside the subshell.
should_start() {
  local skip="$1" port="$2" inuse="${3:-0}"
  run bash -c "export PATH='$FAKEBIN'; export FAKE_LSOF_INUSE='$inuse'; source '$HELPER'; go_service_should_start '$skip' '$port'"
}

bind_port() {
  run bash -c "source '$HELPER'; nlpgo_bind_port '$1' '$2'"
}

# @scenario "A bundled service auto-starts when its runtime is available and its port is free"
@test "starts when go is present and the port is free" {
  with_go
  should_start "" 5561 0
  [ "$status" -eq 0 ]
  [ "$output" = "start" ]
}

# @scenario "An already-running service is reused instead of started twice"
@test "skips (reuse) when the port is already serving" {
  with_go
  should_start "" 5561 1
  [ "$output" = "skip:port-in-use" ]
}

# @scenario "A bundled service does not start when the developer opted out of auto-start"
@test "skips for opt-out when the skip flag is set" {
  with_go
  should_start "1" 5561 0
  [ "$output" = "skip:opted-out" ]
}

# @scenario "A bundled service is not auto-started when its runtime is unavailable"
@test "skips with a manual-run hint when go is absent" {
  # with_go intentionally not called: no `go` on the fake PATH.
  should_start "" 5561 0
  [ "$output" = "skip:no-go-toolchain" ]
}

# @scenario "The NLP engine serves on the address the app calls"
@test "binds the configured localhost port" {
  bind_port 5560 "http://localhost:5561"
  [ "$output" = "5561" ]
  bind_port 5560 "http://127.0.0.1:5599"
  [ "$output" = "5599" ]
}

# @scenario "The NLP engine gets a port of its own when none is configured"
@test "derives app-port-plus-one when the URL is unset or has no port" {
  bind_port 5560 ""
  [ "$output" = "5561" ]
  bind_port 5580 ""
  [ "$output" = "5581" ]
  # A local URL without an explicit port falls back to the derived slot;
  # start.sh then rewrites the app-facing URL to that same port.
  bind_port 5560 "http://localhost"
  [ "$output" = "5561" ]
}

# @scenario "No local NLP engine starts when the app calls a remote NLP service"
@test "returns remote for a non-localhost URL" {
  bind_port 5560 "https://nlp.example.com"
  [ "$output" = "remote" ]
  bind_port 5560 "http://10.0.0.5:5561"
  [ "$output" = "remote" ]
}
