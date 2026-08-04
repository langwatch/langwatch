package cmd

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// sdkCLIEntry is where `pnpm --filter langwatch build` leaves the CLI, relative
// to the worktree root. `haven cli` runs this file rather than a PATH lookup for
// `langwatch`: the one worth running against a local stack is this checkout's,
// not whatever version the developer happens to have installed globally.
const sdkCLIEntry = "sdks/typescript/dist/cli/index.js"

// runExec is `haven exec -- <cmd> [args…]`: run any command with this worktree's
// environment. It exists because the alternatives did not generalise — a
// per-package "cli:haven" script only ever helps the package that carries it,
// and `dotenv -e …` spells out a path the developer should not have to know.
func runExec(_ context.Context, d deps, inv invocation) error {
	if len(inv.args) == 0 {
		return fmt.Errorf("haven exec needs a command to run: haven exec -- <cmd> [args…]")
	}
	return execWithStackEnv(d, inv.args)
}

// runCLI is `haven cli [args…]`: this checkout's langwatch CLI, against this
// stack. Sugar over runExec for the one command developers reach for most.
func runCLI(_ context.Context, d deps, inv invocation) error {
	entry, err := cliEntry(d.worktree)
	if err != nil {
		return err
	}
	return execWithStackEnv(d, append([]string{"node", entry}, inv.args...))
}

// cliEntry locates the built CLI in worktree, or explains how to build it.
func cliEntry(worktree string) (string, error) {
	entry := filepath.Join(worktree, sdkCLIEntry)
	if _, err := os.Stat(entry); err != nil {
		// Naming the build command matters more than naming the missing path:
		// an unbuilt CLI is the normal state of a fresh worktree, not a fault.
		return "", fmt.Errorf("the langwatch CLI is not built yet - run `pnpm --filter langwatch build` (looked for %s)", entry)
	}
	return entry, nil
}

// execWithStackEnv replaces this process with argv, carrying the dotenv layers
// the app itself reads. Replacing rather than supervising is the point: the exit
// code, the signals and the terminal are then the command's own, which is what
// an interactive child needs — the onboarding flow draws a QR code and waits on
// it, and a wrapper that owned the terminal would be in the way.
func execWithStackEnv(d deps, argv []string) error {
	bin, err := exec.LookPath(argv[0])
	if err != nil {
		return fmt.Errorf("haven exec: %q is not on PATH", argv[0])
	}
	env := domain.ExecEnv(os.Environ(), domain.LoadDotenv(d.lwDir))
	return syscall.Exec(bin, argv, env)
}
