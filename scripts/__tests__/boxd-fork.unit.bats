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

# --- _boxd_shell_quote ---

@test "_boxd_shell_quote: wraps plain values in single quotes" {
  result=$(_boxd_shell_quote "feat-foo")
  [ "$result" = "'feat-foo'" ]
}

@test "_boxd_shell_quote: escapes embedded single quotes so injection fails" {
  result=$(_boxd_shell_quote "x'; echo pwned; #")
  # Embedded quote becomes '\'' — the closing ' ends the literal, \' is a
  # literal quote in shell, then '' restarts the literal.
  [ "$result" = "'x'\\''; echo pwned; #'" ]
  # Eval-ing the quoted form should yield the original string back, with no
  # side effects (no 'pwned' to stdout).
  eval "echo $result" > /tmp/boxd-quote-test.out 2>&1
  [ "$(cat /tmp/boxd-quote-test.out)" = "x'; echo pwned; #" ]
  rm -f /tmp/boxd-quote-test.out
}

@test "_boxd_shell_quote: handles empty input" {
  result=$(_boxd_shell_quote "")
  [ "$result" = "''" ]
}

# --- input shape validation (defense in depth) ---

@test "boxd_fork_pr rejects non-numeric input (injection guard)" {
  run boxd_fork_pr "1; rm -rf /"
  [ "$status" -ne 0 ]
  [[ "$output" == *"positive integer"* ]]
}

@test "boxd_fork_issue rejects non-numeric input (injection guard)" {
  run boxd_fork_issue "42'; echo pwned; #"
  [ "$status" -ne 0 ]
  [[ "$output" == *"positive integer"* ]]
}

@test "boxd_fork_branch rejects names failing git check-ref-format" {
  # Space is invalid in git refs.
  run boxd_fork_branch "feat/foo bar"
  [ "$status" -ne 0 ]
  [[ "$output" == *"not a valid git branch name"* ]]
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
  mkdir -p langwatch langevals node_modules/foo .next dist build vendor coverage
  : > langwatch/.env
  : > langevals/.env
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
  [[ "$result" == *"./langevals/.env"* ]]
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

# @scenario "boxd_golden_reset passes -y to non-interactive destroy"
@test "boxd_golden_reset: 'boxd destroy' is invoked with -y so it doesn't prompt" {
  # `boxd destroy` requires --confirm/-y or it prompts and aborts. The
  # reset is already gated by BOXD_FORK_YES=1, so the inner destroy must
  # be non-interactive.
  run grep -E '\$BOXD_BIN" destroy "\$vm" -y' "$SCRIPT_DIR/boxd-fork.sh"
  [ "$status" -eq 0 ]
}

# @scenario "corepack enable is sudo'd so it can write /usr/bin/pnpm"
@test "boxd_golden: 'corepack enable' is invoked with sudo (needs root for /usr/bin symlink)" {
  # corepack enable creates symlinks in /usr/bin and fails EACCES as a
  # non-root user. The provisioning recipe runs as the VM's default user,
  # so the call needs sudo.
  run grep -E 'sudo corepack enable' "$SCRIPT_DIR/boxd-fork.sh"
  [ "$status" -eq 0 ]
}

# @scenario "provisioning recipe wraps remote command in bash -c"
@test "boxd_golden: provisioning recipe invokes bash -c so 'set -o pipefail' works under dash" {
  # boxd exec runs the remote command under /bin/sh, which is dash on
  # Ubuntu/Debian. Dash does not support 'set -o pipefail' — the recipe
  # must wrap in 'bash -c' or the first line dies with
  # "/bin/sh: set: Illegal option -o pipefail" and provisioning fails.
  run grep -E '\$BOXD_BIN" exec "\$vm" -- bash -c' "$SCRIPT_DIR/boxd-fork.sh"
  [ "$status" -eq 0 ]
}

# @scenario "no 'boxd exec ... -- \"...\"' sends 'set -o pipefail' to dash"
@test "boxd-fork.sh: 'set -o pipefail' inside a boxd-exec recipe must be preceded by 'bash -c'" {
  # Regression guard for the dash-vs-bash mismatch: 'boxd exec' runs the
  # remote command under /bin/sh (dash), which can't parse pipefail.
  # For every line containing 'set -o pipefail', walk backwards up to 20
  # lines and require that the enclosing 'boxd exec' invocation includes
  # 'bash -c' before the opening quote of the recipe.
  awk '
    {
      lines[NR] = $0
      if ($0 ~ /set -[a-zA-Z]*o[a-zA-Z]* pipefail/) pipefail_lines[NR] = 1
    }
    END {
      bad = 0
      for (n in pipefail_lines) {
        found_exec = 0; ok = 0
        for (i = n; i >= n - 20 && i > 0; i--) {
          if (lines[i] ~ /\$BOXD_BIN" exec /) {
            found_exec = 1
            if (lines[i] ~ /bash -c/) ok = 1
            break
          }
        }
        if (found_exec && !ok) {
          print "BAD line " n ": pipefail in boxd-exec recipe without bash -c"
          bad = 1
        }
      }
      exit bad
    }
  ' "$SCRIPT_DIR/boxd-fork.sh"
}

# ---------------------------------------------------------------------------
# boxd_preview_vm_name
# ---------------------------------------------------------------------------

@test "boxd_preview_vm_name: returns preview-<slug(branch)>" {
  result=$(boxd_preview_vm_name "feat/dark-mode")
  [ "$result" = "preview-feat-dark-mode" ]
}

@test "boxd_preview_vm_name: slugifies branch with special chars" {
  result=$(boxd_preview_vm_name "fix/User's Bug #42!")
  [[ "$result" == preview-* ]]
  [[ "$result" =~ ^preview-[a-z0-9-]+$ ]]
}

@test "boxd_preview_vm_name: truncates slug to 40 chars after prefix" {
  result=$(boxd_preview_vm_name "feat/this-is-an-extremely-long-branch-name-that-should-get-truncated")
  # prefix is "preview-" (8 chars) + up to 40 chars slug = up to 48 total
  [ "${#result}" -le 48 ]
  [[ "$result" == preview-* ]]
}

@test "boxd_preview_vm_name: empty branch errors" {
  run boxd_preview_vm_name ""
  [ "$status" -ne 0 ]
}

# ---------------------------------------------------------------------------
# LW_PREVIEW_GOLDEN_SOURCE default
# ---------------------------------------------------------------------------

@test "LW_PREVIEW_GOLDEN_SOURCE defaults to langwatch-golden-v2" {
  run bash -c '
    source "'"$SCRIPT_DIR"'/boxd-fork.sh"
    printf "%s" "$LW_PREVIEW_GOLDEN_SOURCE"
  '
  [ "$status" -eq 0 ]
  [ "$output" = "langwatch-golden-v2" ]
}

@test "LW_PREVIEW_GOLDEN_SOURCE env override is respected" {
  result=$(LW_PREVIEW_GOLDEN_SOURCE="my-custom-golden" bash -c '
    source "'"$SCRIPT_DIR"'/boxd-fork.sh"
    printf "%s" "$LW_PREVIEW_GOLDEN_SOURCE"
  ')
  [ "$result" = "my-custom-golden" ]
}

# ---------------------------------------------------------------------------
# boxd_preview_up — arg validation (no real boxd calls made)
# ---------------------------------------------------------------------------

@test "boxd_preview_up: rejects invalid git branch name" {
  run boxd_preview_up "feat/foo bar"
  [ "$status" -ne 0 ]
  [[ "$output" == *"not a valid git branch name"* ]]
}

@test "boxd_preview_up: rejects empty branch" {
  run boxd_preview_up ""
  [ "$status" -ne 0 ]
  [[ "$output" == *"usage:"* ]]
}

# ---------------------------------------------------------------------------
# boxd_preview_down — arg validation
# ---------------------------------------------------------------------------

@test "boxd_preview_down: rejects empty branch" {
  run boxd_preview_down ""
  [ "$status" -ne 0 ]
  [[ "$output" == *"usage:"* ]]
}

@test "boxd_preview_down: rejects invalid git branch name" {
  run boxd_preview_down "feat/foo bar"
  [ "$status" -ne 0 ]
  [[ "$output" == *"not a valid git branch name"* ]]
}

# ---------------------------------------------------------------------------
# boxd_preview_status — arg validation
# ---------------------------------------------------------------------------

@test "boxd_preview_status: rejects empty branch" {
  run boxd_preview_status ""
  [ "$status" -ne 0 ]
  [[ "$output" == *"usage:"* ]]
}

@test "boxd_preview_status: rejects invalid git branch name" {
  run boxd_preview_status "feat/foo bar"
  [ "$status" -ne 0 ]
  [[ "$output" == *"not a valid git branch name"* ]]
}

# ---------------------------------------------------------------------------
# Preview: pipefail inside boxd exec recipe uses bash -c (regression guard)
# ---------------------------------------------------------------------------

@test "boxd-fork.sh: preview helpers' boxd-exec recipes wrap pipefail in bash -c" {
  # Same lint applied to the main script — scan preview_ functions too.
  awk '
    {
      lines[NR] = $0
      if ($0 ~ /set -[a-zA-Z]*o[a-zA-Z]* pipefail/) pipefail_lines[NR] = 1
    }
    END {
      bad = 0
      for (n in pipefail_lines) {
        found_exec = 0; ok = 0
        for (i = n; i >= n - 20 && i > 0; i--) {
          if (lines[i] ~ /\$BOXD_BIN" exec /) {
            found_exec = 1
            if (lines[i] ~ /bash -c/) ok = 1
            break
          }
        }
        if (found_exec && !ok) {
          print "BAD line " n ": pipefail in boxd-exec recipe without bash -c"
          bad = 1
        }
      }
      exit bad
    }
  ' "$SCRIPT_DIR/boxd-fork.sh"
}
