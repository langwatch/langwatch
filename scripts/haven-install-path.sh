#!/usr/bin/env bash
# Post-install PATH check for `make haven install` (dev/haven.mk).
#
# `go install ./cmd/haven` drops the binary in the Go bin dir (GOBIN, or
# GOPATH/bin). If that dir isn't on PATH the freshly installed `haven`
# command doesn't resolve, so this script offers to append a PATH line to
# the user's shell rc — interactively, never silently. Spec:
# specs/setup/haven-install-path.feature. Tests:
# scripts/__tests__/haven-install-path.unit.bats.

haven_go_bin_dir() {
  local gobin
  gobin="$(go env GOBIN)"
  if [ -n "$gobin" ]; then
    echo "$gobin"
  else
    echo "$(go env GOPATH)/bin"
  fi
}

haven_path_contains() {
  case ":$PATH:" in
    *":$1:"*) return 0 ;;
    *) return 1 ;;
  esac
}

# The rc file for the user's login shell; empty when we don't know the shell
# well enough to edit its config safely.
haven_rc_file() {
  case "$(basename "${SHELL:-}")" in
    zsh) echo "${ZDOTDIR:-$HOME}/.zshrc" ;;
    bash) echo "$HOME/.bashrc" ;;
    fish) echo "${XDG_CONFIG_HOME:-$HOME/.config}/fish/config.fish" ;;
    *) echo "" ;;
  esac
}

haven_path_line() { # $1 = bin dir
  case "$(basename "${SHELL:-}")" in
    fish) echo "fish_add_path $1" ;;
    *) echo "export PATH=\"$1:\$PATH\"" ;;
  esac
}

# Overridable seam for tests: whether we can prompt the user.
haven_stdin_is_tty() {
  [ -t 0 ]
}

# Check PATH for the Go bin dir and offer to fix the rc file if missing.
# $1 = bin dir, $2 = rc file (from haven_rc_file). Reads the prompt answer
# from stdin only when stdin is a TTY; otherwise prints instructions.
haven_ensure_path() {
  local bindir="$1" rc="$2" line answer
  echo "installed haven -> $bindir/haven"

  if haven_path_contains "$bindir"; then
    echo "run 'haven ...' directly from now on"
    return 0
  fi

  line="$(haven_path_line "$bindir")"

  if [ -z "$rc" ]; then
    echo "NOTE: $bindir is not on your PATH and your shell isn't one we know how to configure."
    echo "Add this to your shell config, then restart your shell:"
    echo "  $line"
    return 0
  fi

  if [ -f "$rc" ] && grep -qxF "$line" "$rc"; then
    echo "NOTE: $bindir is not on your PATH yet, but $rc already adds it."
    echo "Restart your shell (or 'source $rc') to pick it up."
    return 0
  fi

  if ! haven_stdin_is_tty; then
    echo "NOTE: $bindir is not on your PATH. Add this to $rc, then restart your shell:"
    echo "  $line"
    return 0
  fi

  printf '%s is not on your PATH. Add it to %s? [Y/n] ' "$bindir" "$rc"
  read -r answer || answer=""
  case "$answer" in
    n* | N*)
      echo "Skipped. To add it yourself, append this to $rc:"
      echo "  $line"
      ;;
    *)
      {
        echo ""
        echo "# added by 'make haven install' (langwatch)"
        echo "$line"
      } >>"$rc"
      echo "Added to $rc — restart your shell (or 'source $rc'), then run 'haven ...' directly."
      ;;
  esac
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  set -euo pipefail
  haven_ensure_path "$(haven_go_bin_dir)" "$(haven_rc_file)"
fi
