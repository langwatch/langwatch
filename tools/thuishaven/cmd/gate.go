package cmd

import (
	"context"
	"fmt"
	"os"
	"strconv"

	"github.com/langwatch/langwatch/tools/thuishaven/app"
	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// runHeavy is `haven run` — take a machine-wide slot, run the command, release.
//
// The command arrives as ONE argument on --sh rather than as trailing argv,
// because the gate hands over a shell string and splicing it bare would let
// everything after an operator run outside the slot.
func runHeavy(ctx context.Context, d deps, inv invocation) error {
	shell := inv.value("--sh")
	if shell == "" {
		return fmt.Errorf("haven run needs a command: haven run --sh 'pnpm test:unit'")
	}
	// One pool exists, so any other name is a request haven cannot honour.
	// Accepting it silently would run the command against the heavy pool while
	// the caller believes it took a different one.
	if class := inv.value("--class"); class != "" && class != domain.HeavySlotClass {
		return fmt.Errorf("haven run has one slot class today, %q — not %q", domain.HeavySlotClass, class)
	}
	return d.orch.RunHeavy(ctx, app.HeavyRun{
		Shell:   shell,
		Dir:     d.worktree,
		AgentID: inv.value("--agent-id"),
		// The gate decided the width; this only applies it. A count that will not
		// parse is treated as absent rather than fatal, because refusing to run
		// over a malformed flag would be the gate breaking the command it rewrote.
		Workers: positiveInt(inv.value("--workers")),
		// A terminal on stdout means a human is watching, and a human waiting is
		// not an idle API session — so they keep the long failsafe rather than an
		// agent's tighter ceiling.
		Interactive: stdoutIsTTY(),
	})
}

// positiveInt reads a count, treating anything unparseable or non-positive as
// unset.
func positiveInt(s string) int {
	n, err := strconv.Atoi(s)
	if err != nil || n < 1 {
		return 0
	}
	return n
}

// runGate is `haven gate` — answer one Claude Code PreToolUse hook.
//
// There is no install flag: `haven setup gate-hook` registers this in the
// worktree's own .claude/settings.local.json, and it is opt-in — `haven up`
// installs nothing that changes how another tool behaves. A command whose job
// is answering hooks should not also be the thing that installs them.
//
// It always exits 0. Exit code 2 BLOCKS the tool call, and an unrecovered Go
// panic exits with exactly 2, so returning an error from here would risk
// converting a haven bug into a machine-wide tool-call blocker. Every failure
// inside Gate already resolves to "defer".
func runGate(_ context.Context, d deps, _ invocation) error {
	d.orch.Gate(os.Stdin, os.Stdout)
	return nil
}
