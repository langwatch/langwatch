#!/usr/bin/env bash
#
# Renders the chart and asserts how the previous credentials key reaches the
# processes during a CREDENTIALS_SECRET rotation.
#
# CREDENTIALS_SECRET_PREVIOUS lets a process decrypt data written under the key
# being rotated away from. Two things are only visible in the render: an
# install that names no previous key carries no such variable, and every
# process that gets CREDENTIALS_SECRET gets the previous key beside it. A
# process holding only the new key fails to decrypt every stored credential it
# touches until the rotation finishes.
#
# Each test carries a plain "# Verifies:" line naming what it pins.
#
# Usage (from charts/langwatch):
#   helm dependency build .
#   ./tests/credentials-secret-previous.sh

set -euo pipefail

cd "$(dirname "$0")/.."

failures=0

fail() {
  echo "FAIL [$1]: $2"
  failures=$((failures + 1))
}

# Render the chart, tolerating a non-zero exit so a render failure becomes an
# assertion outcome with context rather than a bare `set -e` abort.
render_to() {
  local out="$1" err="$2" release="$3"
  shift 3
  local status
  helm template "$release" . "$@" >"$out" 2>"$err" && status=0 || status=$?
  return $status
}

# The lines that follow `- name: <var>` inside ONE template's Source block, up
# to the next list item, without comments and blank lines. $2 is the template
# path fragment naming the workload.
env_entry_in() {
  local render="$1" src="$2" var="$3"
  awk -v want="$src" -v var="$var" '
    /^# Source:/ { insrc = (index($0, want) > 0); inentry = 0 }
    insrc && /^[[:space:]]*- name:[[:space:]]/ {
      inentry = ($0 ~ "- name: " var "$")
      next
    }
    /^[[:space:]]*(#|$)/ { next }
    insrc && inentry { sub(/^[[:space:]]*/, ""); print }
  ' "$render"
}

PREVIOUS="CREDENTIALS_SECRET_PREVIOUS"
OLD_KEY="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

# Every template that runs the app image and is given CREDENTIALS_SECRET.
PROCESSES=(
  "app/deployment.yaml"
  "workers/deployment.yaml"
  "app/migrate-pre-roll-job.yaml"
)

# Verifies: an install that names no previous key renders no such variable,
# with autogen on and with an operator-owned Secret
test_unset_renders_nothing() {
  local posture found
  for posture in autogen operator; do
    local out="${TMPDIR:-/tmp}/creds-previous-unset-$posture.yaml"
    local err="${TMPDIR:-/tmp}/creds-previous-unset-$posture.err"
    local -a args=(--set autogen.enabled=true)
    [[ "$posture" == "operator" ]] && args=(-f tests/values-autogen-off.yaml)
    if ! render_to "$out" "$err" t "${args[@]}"; then
      fail "unset-render-$posture" "render failed:
$(cat "$err")"
      continue
    fi
    found="$(grep -c "$PREVIOUS" "$out" || true)"
    if [[ "$found" != "0" ]]; then
      fail "unset-emits-$posture" \
        "the $posture render carries $found $PREVIOUS line(s) although no previous key is named. autogen must never generate one: a random previous key decrypts nothing."
    fi
  done
}

# Verifies: an inline previous key reaches the app, the workers and the
# migration Job
test_value_reaches_every_process() {
  local out="${TMPDIR:-/tmp}/creds-previous-value.yaml"
  local err="${TMPDIR:-/tmp}/creds-previous-value.err"
  if ! render_to "$out" "$err" t \
      --set autogen.enabled=true \
      --set "app.credentialsEncryptionKey.previous.value=$OLD_KEY"; then
    fail "value-render" "render with an inline previous key failed:
$(cat "$err")"
    return
  fi

  local process entry
  for process in "${PROCESSES[@]}"; do
    entry="$(env_entry_in "$out" "$process" "$PREVIOUS")"
    if [[ "$entry" != "value: \"$OLD_KEY\"" ]]; then
      fail "value-$process" \
        "$process carries '${entry:-<nothing>}' for $PREVIOUS, expected the inline value. A process without the previous key cannot read credentials stored before the rotation."
    fi
    if [[ -z "$(env_entry_in "$out" "$process" "CREDENTIALS_SECRET")" ]]; then
      fail "value-current-$process" \
        "$process lost CREDENTIALS_SECRET when the previous key was set."
    fi
  done
}

# Verifies: a secretKeyRef renders a secretKeyRef on every process, and wins
# over an inline value
test_secret_key_ref_renders_a_reference() {
  local out="${TMPDIR:-/tmp}/creds-previous-ref.yaml"
  local err="${TMPDIR:-/tmp}/creds-previous-ref.err"
  if ! render_to "$out" "$err" t \
      --set autogen.enabled=true \
      --set "app.credentialsEncryptionKey.previous.value=$OLD_KEY" \
      --set app.credentialsEncryptionKey.previous.secretKeyRef.name=rotation-keys \
      --set app.credentialsEncryptionKey.previous.secretKeyRef.key=old-key; then
    fail "ref-render" "render with a previous-key secretKeyRef failed:
$(cat "$err")"
    return
  fi

  local process entry expected
  expected="valueFrom:
secretKeyRef:
name: rotation-keys
key: old-key"
  for process in "${PROCESSES[@]}"; do
    entry="$(env_entry_in "$out" "$process" "$PREVIOUS")"
    if [[ "$entry" != "$expected" ]]; then
      fail "ref-$process" \
        "$process carries '${entry:-<nothing>}' for $PREVIOUS, expected a secretKeyRef to rotation-keys/old-key."
    fi
  done
  if grep -q "$OLD_KEY" "$out"; then
    fail "ref-leaks-value" \
      "the inline previous key is in the render although a secretKeyRef is set. The reference must win, so the key stays out of the pod spec."
  fi
}

# Verifies: with an operator-owned Secret, the previous key is read from it
# only when its key name is given
test_existing_secret_key_is_opt_in() {
  local out="${TMPDIR:-/tmp}/creds-previous-existing.yaml"
  local err="${TMPDIR:-/tmp}/creds-previous-existing.err"
  if ! render_to "$out" "$err" t \
      -f tests/values-autogen-off.yaml \
      --set secrets.secretKeys.credentialsEncryptionKeyPrevious=credentials-encryption-key-previous; then
    fail "existing-render" "render with a previous key in the operator Secret failed:
$(cat "$err")"
    return
  fi

  local secret process entry
  secret="$(awk '/^  existingSecret:/ { print $2; exit }' tests/values-autogen-off.yaml)"
  for process in "${PROCESSES[@]}"; do
    entry="$(env_entry_in "$out" "$process" "$PREVIOUS")"
    if [[ "$entry" != "valueFrom:
secretKeyRef:
name: $secret
key: credentials-encryption-key-previous" ]]; then
      fail "existing-$process" \
        "$process carries '${entry:-<nothing>}' for $PREVIOUS, expected a secretKeyRef to $secret/credentials-encryption-key-previous."
    fi
  done
}

# Verifies: a secretKeyRef that names a Secret but no key stops the render
test_half_written_reference_is_refused() {
  local out="${TMPDIR:-/tmp}/creds-previous-half.yaml"
  local err="${TMPDIR:-/tmp}/creds-previous-half.err"
  if render_to "$out" "$err" t \
      --set autogen.enabled=true \
      --set app.credentialsEncryptionKey.previous.secretKeyRef.name=rotation-keys; then
    fail "half-renders" \
      "a previous-key secretKeyRef with a name and no key rendered. It resolves to nothing in the container, so the rotation would fail at the first decrypt instead of at install."
    return
  fi
  if ! grep -q "app.credentialsEncryptionKey.previous.secretKeyRef.name is set but key is empty" "$err"; then
    fail "half-message" "the render failed without naming the value to fix:
$(cat "$err")"
  fi
}

test_unset_renders_nothing
test_value_reaches_every_process
test_secret_key_ref_renders_a_reference
test_existing_secret_key_is_opt_in
test_half_written_reference_is_refused

if [[ $failures -gt 0 ]]; then
  echo
  echo "$failures check(s) failed"
  exit 1
fi

echo "PASS: previous credentials key pinned: (1) unset renders no $PREVIOUS; (2) an inline value reaches app, workers and the migration Job; (3) a secretKeyRef renders a reference and wins over a value; (4) an operator Secret supplies it only when its key is named; (5) a reference with no key stops the render"
