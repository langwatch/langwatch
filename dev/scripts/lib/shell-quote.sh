#!/bin/bash
# Wrap a string so a shell re-reading the command line gets it back whole.
#
# `pnpm dev` hands each lane to concurrently as one command line, which
# concurrently runs through /bin/sh. A lane command carries double quotes of
# its own (`make -C "$REPO_ROOT" …`, `PATH="$SHIM:$PATH" …`), so building the
# line with double quotes ends the quoting early and the rest of the lane is
# re-split by that shell: a PATH entry holding a space then arrives as two
# words and the lane dies with "No such file or directory".
#
# Single quotes end only at the next single quote, so this is the one wrapper
# sh cannot see through. `$PATH` and `${VAR:-default}` inside a lane command
# stay literal here on purpose: dev/scripts/lane.sh expands them, in the lane's
# own shell, which is where the defaults are meant to apply.
#
# See specs/setup/dev-stack-log-format.feature.
shell_quote() {
  printf "'%s'" "${1//\'/\'\\\'\'}"
}
