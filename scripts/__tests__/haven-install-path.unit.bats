#!/usr/bin/env bats
# Unit tests for scripts/haven-install-path.sh — the post-`make haven install`
# PATH check (specs/setup/haven-install-path.feature). Tests drive
# haven_ensure_path directly with a temp rc file and a controlled PATH.
# bats runs without a TTY, so the interactive branch is reached by
# overriding the haven_stdin_is_tty seam and feeding the answer on stdin.

SCRIPT_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"

setup() {
  TEST_DIR="$(mktemp -d)"
  RC="$TEST_DIR/.zshrc"
  BINDIR="$TEST_DIR/gobin"
  mkdir -p "$BINDIR"
  export SHELL=/bin/zsh
  source "$SCRIPT_DIR/haven-install-path.sh"
}

teardown() {
  rm -rf "$TEST_DIR"
}

# --- haven_path_contains ---

@test "haven_path_contains: finds an exact PATH entry" {
  PATH="$BINDIR:$PATH" haven_path_contains "$BINDIR"
}

@test "haven_path_contains: does not match a prefix of a longer entry" {
  PATH="$BINDIR-other:$PATH" run haven_path_contains "$BINDIR"
  [ "$status" -ne 0 ]
}

# --- haven_rc_file / haven_path_line per shell ---

@test "haven_rc_file: zsh uses .zshrc, honoring ZDOTDIR" {
  SHELL=/bin/zsh ZDOTDIR="$TEST_DIR" run haven_rc_file
  [ "$output" = "$TEST_DIR/.zshrc" ]
}

@test "haven_rc_file: bash uses ~/.bashrc" {
  SHELL=/bin/bash run haven_rc_file
  [ "$output" = "$HOME/.bashrc" ]
}

@test "haven_rc_file: fish uses config.fish" {
  SHELL=/usr/bin/fish XDG_CONFIG_HOME="$TEST_DIR/xdg" run haven_rc_file
  [ "$output" = "$TEST_DIR/xdg/fish/config.fish" ]
}

@test "haven_rc_file: unknown shell yields empty" {
  SHELL=/bin/tcsh run haven_rc_file
  [ "$output" = "" ]
}

@test "haven_path_line: fish uses fish_add_path, others export PATH" {
  SHELL=/usr/bin/fish run haven_path_line "$BINDIR"
  [ "$output" = "fish_add_path $BINDIR" ]
  SHELL=/bin/zsh run haven_path_line "$BINDIR"
  [ "$output" = "export PATH=\"$BINDIR:\$PATH\"" ]
}

# --- haven_ensure_path ---

# @scenario "Go bin dir already on PATH"
@test "bin dir on PATH: confirms install and offers nothing" {
  PATH="$BINDIR:$PATH" run haven_ensure_path "$BINDIR" "$RC"
  [ "$status" -eq 0 ]
  [[ "$output" == *"installed haven -> $BINDIR/haven"* ]]
  [[ "$output" == *"run 'haven ...' directly"* ]]
  [ ! -f "$RC" ]
}

# @scenario "Non-interactive install never edits the rc file"
@test "bin dir missing, no TTY: prints the line, leaves rc untouched" {
  touch "$RC"
  run haven_ensure_path "$BINDIR" "$RC" </dev/null
  [ "$status" -eq 0 ]
  [[ "$output" == *"not on your PATH"* ]]
  [[ "$output" == *"export PATH=\"$BINDIR:\$PATH\""* ]]
  [ ! -s "$RC" ]
}

# @scenario "Go bin dir missing from PATH, user accepts"
@test "user accepts: appends the PATH line to the rc file" {
  run_with_tty_answer "y"
  [ "$status" -eq 0 ]
  grep -qxF "export PATH=\"$BINDIR:\$PATH\"" "$RC"
  [[ "$output" == *"restart your shell"* ]]
}

@test "user accepts via empty answer (default yes)" {
  run_with_tty_answer ""
  [ "$status" -eq 0 ]
  grep -qxF "export PATH=\"$BINDIR:\$PATH\"" "$RC"
}

# @scenario "Go bin dir missing from PATH, user declines"
@test "user declines: rc untouched, manual line printed" {
  touch "$RC"
  run_with_tty_answer "n"
  [ "$status" -eq 0 ]
  [ ! -s "$RC" ]
  [[ "$output" == *"Skipped"* ]]
  [[ "$output" == *"export PATH=\"$BINDIR:\$PATH\""* ]]
}

# @scenario "Accepting twice does not duplicate the PATH line"
@test "second run after accept: no duplicate line, says already configured" {
  run_with_tty_answer "y"
  run_with_tty_answer "y"
  [ "$status" -eq 0 ]
  [ "$(grep -cxF "export PATH=\"$BINDIR:\$PATH\"" "$RC")" -eq 1 ]
  [[ "$output" == *"already adds it"* ]]
}

# @scenario "Unrecognized shell falls back to instructions"
@test "unknown shell: empty rc arg prints instructions only" {
  SHELL=/bin/tcsh run haven_ensure_path "$BINDIR" ""
  [ "$status" -eq 0 ]
  [[ "$output" == *"shell isn't one we know how to configure"* ]]
  [[ "$output" == *"export PATH=\"$BINDIR:\$PATH\""* ]]
}

# Take the interactive branch (haven_stdin_is_tty overridden to true) and
# answer the prompt with $1.
run_with_tty_answer() {
  local answer="$1"
  haven_stdin_is_tty() { return 0; }
  run haven_ensure_path "$BINDIR" "$RC" <<<"$answer"
}
