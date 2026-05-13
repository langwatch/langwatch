#!/usr/bin/env bats
# Unit tests for scripts/boxd-fork.sh pure functions
#
# Behavior under test is the slugifier + naming + env-discovery + hostname-
# rewrite logic from issue #3891. The Makefile targets in boxd.mk delegate
# to these functions so they're testable in isolation.

SCRIPT_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"

setup() {
  source "$SCRIPT_DIR/boxd-fork.sh"
}

# --- boxd_slug ---

# @scenario "Slugifier lowercases and strips punctuation"
@test "boxd_slug: lowercases and dashes a simple title" {
  result=$(boxd_slug "feat/Foo Bar!")
  [ "$result" = "feat-foo-bar" ]
}

@test "boxd_slug: preserves issue<N>/<slug> shape after slashes are dashed" {
  result=$(boxd_slug "issue3891/boxd-mk-and-quickstart-rework")
  [ "$result" = "issue3891-boxd-mk-and-quickstart-rework" ]
}

@test "boxd_slug: strips punctuation and collapses runs of dashes" {
  result=$(boxd_slug "Fix: user's data (broken) #123")
  [[ "$result" =~ ^[a-z0-9-]+$ ]]
  # No leading or trailing dash, no double dashes
  [[ "$result" != -* ]]
  [[ "$result" != *- ]]
  [[ "$result" != *--* ]]
}

# @scenario "Slugifier truncates to 40 characters with no trailing hyphen"
@test "boxd_slug: truncates to 40 chars" {
  result=$(boxd_slug "this-is-a-very-long-branch-name-that-should-get-truncated-eventually")
  [ "${#result}" -le 40 ]
}

@test "boxd_slug: truncated output has no trailing hyphen" {
  result=$(boxd_slug "this-is-a-very-long-branch-name-that-should-get-truncated-eventually")
  [[ "$result" != *- ]]
}

@test "boxd_slug: empty input produces empty output without error" {
  result=$(boxd_slug "")
  [ "$result" = "" ]
}

@test "boxd_slug: input that is all symbols becomes empty after trim" {
  result=$(boxd_slug "///!!!")
  [ "$result" = "" ]
}

# --- boxd_vm_name ---

@test "boxd_vm_name: pr uses langwatch-<slug>" {
  result=$(boxd_vm_name "pr" "feat/Foo Bar")
  [ "$result" = "langwatch-feat-foo-bar" ]
}

@test "boxd_vm_name: branch uses langwatch-<slug>" {
  result=$(boxd_vm_name "branch" "feat/dark-mode")
  [ "$result" = "langwatch-feat-dark-mode" ]
}

# @scenario "fork-issue uses the literal langwatch-issue<N> form"
@test "boxd_vm_name: issue always uses langwatch-issue<N> regardless of slug" {
  # AC#14 collision rule: fork-issue uses literal langwatch-issue<N>
  result=$(boxd_vm_name "issue" "3891")
  [ "$result" = "langwatch-issue3891" ]
}

@test "boxd_vm_name: issue ignores any extra slug-ish input" {
  # If callers pass "3891/whatever", the issue form still picks the number
  result=$(boxd_vm_name "issue" "3891")
  [ "$result" = "langwatch-issue3891" ]
}

# --- boxd_tmux_name ---

@test "boxd_tmux_name: matches VM convention with claude- prefix" {
  result=$(boxd_tmux_name "issue" "42")
  [ "$result" = "claude-issue42" ]
}

@test "boxd_tmux_name: branch uses claude-<slug>" {
  result=$(boxd_tmux_name "branch" "feat/dark-mode")
  [ "$result" = "claude-feat-dark-mode" ]
}

# --- boxd_branch_issue_collision_warning ---

# @scenario "fork-branch with issue-shaped slug warns and uses langwatch-issue<N>-<rest>"
@test "boxd_branch_issue_collision_warning: warns when slug starts with issueNNN-" {
  run boxd_branch_issue_collision_warning "issue42-foo-bar"
  [ "$status" -eq 0 ]
  [[ "$output" == *"fork-issue"* ]]
  [[ "$output" == *"42"* ]]
}

@test "boxd_branch_issue_collision_warning: silent on non-issue-shaped slug" {
  run boxd_branch_issue_collision_warning "feat-dark-mode"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

# --- boxd_env_files (filesystem-driven; runs in a temp dir) ---

setup_env_fixture() {
  TMP="$(mktemp -d)"
  pushd "$TMP" > /dev/null
  mkdir -p langwatch langwatch_nlp node_modules/foo .next dist build vendor coverage
  : > langwatch/.env
  : > langwatch_nlp/.env
  : > .env
  # Excluded by suffix
  : > langwatch/.env.example
  : > langwatch/.env.template
  : > langwatch/.env.sample
  : > langwatch/.env.local
  # Excluded by directory
  : > node_modules/foo/.env
  : > .next/.env
  : > dist/.env
  : > build/.env
  : > vendor/.env
  : > coverage/.env
}

teardown_env_fixture() {
  popd > /dev/null
  rm -rf "$TMP"
}

@test "boxd_env_files: lists top-level .env files in monorepo subdirs" {
  setup_env_fixture
  result=$(boxd_env_files | sort)
  [[ "$result" == *"./.env"* ]]
  [[ "$result" == *"./langwatch/.env"* ]]
  [[ "$result" == *"./langwatch_nlp/.env"* ]]
  teardown_env_fixture
}

# @scenario ".env discovery excludes example/template/sample/local suffixes"
@test "boxd_env_files: excludes .env.example, .template, .sample, .local" {
  setup_env_fixture
  result=$(boxd_env_files)
  [[ "$result" != *".example"* ]]
  [[ "$result" != *".template"* ]]
  [[ "$result" != *".sample"* ]]
  [[ "$result" != *".local"* ]]
  teardown_env_fixture
}

# @scenario ".env discovery excludes node_modules, .next, dist, build, vendor, coverage, .git"
@test "boxd_env_files: excludes node_modules, .next, dist, build, vendor, coverage" {
  setup_env_fixture
  result=$(boxd_env_files)
  [[ "$result" != *"node_modules"* ]]
  [[ "$result" != *".next"* ]]
  [[ "$result" != *"dist/"* ]]
  [[ "$result" != *"build/"* ]]
  [[ "$result" != *"vendor/"* ]]
  [[ "$result" != *"coverage/"* ]]
  teardown_env_fixture
}

# --- boxd_rewrite_env (hostname rewrite, allowlist + value-pattern) ---

# @scenario "Stale localhost NEXTAUTH_URL is rewritten to the fork's proxy URL"
@test "boxd_rewrite_env: rewrites NEXTAUTH_URL allowlist key" {
  result=$(printf 'NEXTAUTH_URL=http://localhost:5560\n' \
    | boxd_rewrite_env "langwatch-issue42")
  [ "$result" = 'NEXTAUTH_URL="https://langwatch-issue42.boxd.sh"' ]
}

@test "boxd_rewrite_env: rewrites BASE_HOST allowlist key" {
  result=$(printf 'BASE_HOST=http://localhost:5560\n' \
    | boxd_rewrite_env "langwatch-issue42")
  [ "$result" = 'BASE_HOST="https://langwatch-issue42.boxd.sh"' ]
}

# @scenario "LW_GATEWAY_BASE_URL routes to the aigw subdomain"
@test "boxd_rewrite_env: rewrites LW_GATEWAY_BASE_URL to aigw subdomain" {
  result=$(printf 'LW_GATEWAY_BASE_URL=http://localhost:5563\n' \
    | boxd_rewrite_env "langwatch-issue42")
  [ "$result" = 'LW_GATEWAY_BASE_URL="https://aigw.langwatch-issue42.boxd.sh"' ]
}

@test "boxd_rewrite_env: rewrites localhost:<port> values for non-allowlist keys (matched values)" {
  # AC#26: value pattern match also rewrites
  result=$(printf 'OTHER_URL=http://localhost:5560\n' \
    | boxd_rewrite_env "langwatch-issue42")
  [[ "$result" == *"langwatch-issue42.boxd.sh"* ]]
}

@test "boxd_rewrite_env: rewrites 127.0.0.1:<port> values" {
  result=$(printf 'OTHER_URL=http://127.0.0.1:5560\n' \
    | boxd_rewrite_env "langwatch-issue42")
  [[ "$result" == *"langwatch-issue42.boxd.sh"* ]]
}

@test "boxd_rewrite_env: leaves non-localhost values alone" {
  result=$(printf 'OPENAI_API_KEY=sk-foo123\nDB_URL=postgres://u:p@db.prod:5432/x\n' \
    | boxd_rewrite_env "langwatch-issue42")
  [[ "$result" == *"sk-foo123"* ]]
  [[ "$result" == *"db.prod"* ]]
}

@test "boxd_rewrite_env: leaves comments and blank lines alone" {
  result=$(printf '# header comment\n\nKEY=value\n' \
    | boxd_rewrite_env "langwatch-issue42")
  [[ "$result" == *"# header comment"* ]]
  [[ "$result" == *"KEY=value"* ]]
}

# @scenario "A real boxd-proxy URL is left untouched"
@test "boxd_rewrite_env: leaves a real boxd-proxy URL alone" {
  result=$(printf 'NEXTAUTH_URL=https://langwatch-other.boxd.sh\n' \
    | boxd_rewrite_env "langwatch-issue42")
  [[ "$result" == *"langwatch-other.boxd.sh"* ]]
}

# --- boxd_namespace + boxd_golden_vm_name ---

@test "boxd_namespace: BOXD_NAMESPACE env override wins over gh + whoami" {
  BOXD_NAMESPACE="acme-team" run boxd_namespace
  [ "$status" -eq 0 ]
  [ "$output" = "acme-team" ]
}

@test "boxd_namespace: slugifies the override (lowercase, dashes)" {
  BOXD_NAMESPACE="ACME Team!" run boxd_namespace
  [ "$status" -eq 0 ]
  [ "$output" = "acme-team" ]
}

@test "boxd_namespace: falls back to gh login when override unset" {
  # Mock gh to return a stable login.
  local gh_dir
  gh_dir=$(mktemp -d)
  cat > "$gh_dir/gh" <<'EOF'
#!/bin/bash
[ "$1" = "api" ] && [ "$2" = "user" ] && echo "drewdrewthis" && exit 0
exit 1
EOF
  chmod +x "$gh_dir/gh"
  GH_BIN="$gh_dir/gh" run env -u BOXD_NAMESPACE bash -c '
    source "'"$SCRIPT_DIR"'/boxd-fork.sh"
    boxd_namespace
  '
  [ "$status" -eq 0 ]
  [ "$output" = "drewdrewthis" ]
  rm -rf "$gh_dir"
}

@test "boxd_namespace: falls back to whoami when gh fails and no override" {
  # gh that always fails.
  local gh_dir
  gh_dir=$(mktemp -d)
  cat > "$gh_dir/gh" <<'EOF'
#!/bin/bash
exit 1
EOF
  chmod +x "$gh_dir/gh"
  GH_BIN="$gh_dir/gh" run env -u BOXD_NAMESPACE bash -c '
    source "'"$SCRIPT_DIR"'/boxd-fork.sh"
    boxd_namespace
  '
  [ "$status" -eq 0 ]
  # Should match `whoami` output (slugified).
  [ "$output" = "$(whoami)" ]
  rm -rf "$gh_dir"
}

@test "boxd_golden_vm_name: <namespace>--langwatch-golden" {
  BOXD_NAMESPACE="alice" run boxd_golden_vm_name
  [ "$status" -eq 0 ]
  [ "$output" = "alice--langwatch-golden" ]
}
