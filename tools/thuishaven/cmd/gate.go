package cmd

import (
	"context"
	"fmt"
	"os"

	"github.com/langwatch/langwatch/tools/thuishaven/app"
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
	return d.orch.RunHeavy(ctx, app.HeavyRun{
		Shell:   shell,
		Dir:     d.lwDir,
		AgentID: inv.value("--agent-id"),
		// A terminal on stdout means a human is watching, and a human waiting is
		// not an idle API session — so they keep the long failsafe rather than an
		// agent's tighter ceiling.
		Interactive: stdoutIsTTY(),
	})
}

// runGate is `haven gate` — answer one Claude Code PreToolUse hook.
//
// It always exits 0. Exit code 2 BLOCKS the tool call, and an unrecovered Go
// panic exits with exactly 2, so returning an error from here would risk
// converting a haven bug into a machine-wide tool-call blocker. Every failure
// inside Gate already resolves to "defer".
func runGate(_ context.Context, d deps, _ invocation) error {
	d.orch.Gate(os.Stdin, os.Stdout)
	return nil
}
