package havenrun

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// Layout aliases the orchestrator's own checkout-shape type, so a caller's
// prepare step and the boot status it later reads (StackStatus.Layout) agree
// on one definition instead of two.
type Layout = domain.Layout

// LayoutModular and LayoutMonolith name the two checkout shapes PrepareCommands
// branches on.
const (
	LayoutModular  = domain.LayoutModular
	LayoutMonolith = domain.LayoutMonolith
)

// PrepareStep is one command a fresh worktree needs before `haven up` can
// succeed on it: a name and argv, run in the worktree's own directory. Each
// caller runs it through its own commandSpec-shaped type (with its own dir
// and env), so this carries neither.
type PrepareStep struct {
	Name string
	Args []string
}

// PrepareCommands are the steps a fresh worktree needs before `haven up` can
// succeed on it, in order: an install (pnpm's workspace symlinks are per
// worktree, so a developer's own node_modules is no help here), then the
// generated files (Prisma client, evaluator types, the langy skill/setup
// generators), then - modular layout only - the workspace packages the api
// and worker import a built dist from. CI is unset for the install so
// install-check-shims and friends behave as they do for a person, not for a
// pipeline (dev/scripts/install-check-shims.mjs stands down under CI).
//
// The monolith layout's own generated-files script (platform/app's
// start:prepare:files, on origin/main) already builds the SDK and the MCP
// server inline, so it needs no separate build step; the modular layout's
// does not - only each application's own predev hook runs
// dev/scripts/ensure-built.mjs, and nothing here can rely on a
// haven-supervised lane's predev having already run before an earlier
// prepare step imports the same dist. Both layouts run
// `pnpm run start:prepare:files` unchanged: the script name is the same on
// both refs and each ref's own package.json resolves it to what that ref
// actually needs.
func PrepareCommands(layout Layout) []PrepareStep {
	steps := []PrepareStep{
		{Name: "env", Args: []string{"-u", "CI", "pnpm", "install", "--frozen-lockfile"}},
		{Name: "pnpm", Args: []string{"run", "start:prepare:files"}},
	}
	if layout == LayoutModular {
		steps = append(steps, PrepareStep{Name: "node", Args: []string{"dev/scripts/ensure-built.mjs"}})
	}
	return steps
}

// envDotfilePrefix is what a workspace's own dotenv files are named (.env,
// .env.local, ...). CLAUDE.md: ".env lives at the workspace root" - so the
// workspace root is the only directory CopyEnvFiles copies from.
const envDotfilePrefix = ".env"

// CopyEnvFiles copies the developer's own untracked .env* files from root
// (the main checkout's workspace root) into dir (a fresh worktree). A tracked
// file (.env.example) is left alone, checked the same way
// .githooks/post-checkout does: `git ls-files` inside the worktree. It
// reports how many files it copied; only file NAMES ever reach a caller's log
// line - never a byte of a file's contents.
func CopyEnvFiles(ctx context.Context, root, dir string) (int, error) {
	entries, err := os.ReadDir(root)
	if err != nil {
		return 0, err
	}
	copied := 0
	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() || !strings.HasPrefix(name, envDotfilePrefix) {
			continue
		}
		if envFileTracked(ctx, dir, name) {
			continue
		}
		if err := copyEnvFile(filepath.Join(root, name), filepath.Join(dir, name)); err != nil {
			return copied, err
		}
		copied++
	}
	return copied, nil
}

// envFileTracked reports whether name is a tracked file in the worktree at
// dir - true for .env.example, false for every real dotenv file, which is
// gitignored everywhere in this repository.
func envFileTracked(ctx context.Context, dir, name string) bool {
	// #nosec G204 -- name comes from os.ReadDir(root) above, never external
	// input, and dir is one of the caller's own worktrees.
	return exec.CommandContext(ctx, "git", "-C", dir, "ls-files", "--error-unmatch", name).Run() == nil
}

// copyEnvFile copies one dotenv file byte-for-byte. Never logged: the caller
// reports only a count and file names it already decided on, never a byte of
// what either file contains.
func copyEnvFile(src, dest string) error {
	data, err := os.ReadFile(src) // #nosec G304 -- src is one of the operator's own workspace-root dotenv files, named by CopyEnvFiles.
	if err != nil {
		return err
	}
	// #nosec G306 G703 -- dest is a path CopyEnvFiles built from the caller's
	// own fresh worktree dir and a dotenv filename read off disk, not
	// external input; 0o600 mirrors the source file's own mode.
	return os.WriteFile(dest, data, 0o600)
}

// portlessHomeEnv is the override root.go's havenHome() itself reads;
// duplicated here (rather than importing the cmd package, haven's own
// composition root) so a caller can find a stack's log file without pulling
// in the CLI.
const portlessHomeEnv = "LANGWATCH_PORTLESS_HOME"

// StackLogFile is the combined log haven writes for one stack, independent
// of any single lane. It is the fallback source for a boot that never became
// healthy: `haven logs` is itself a command that can fail (see
// StackLogTailOrError), where a direct read of this file still works.
func StackLogFile(slug string) string {
	home := os.Getenv(portlessHomeEnv)
	if home == "" {
		if dir, err := os.UserHomeDir(); err == nil {
			home = filepath.Join(dir, ".langwatch", "portless")
		}
	}
	return filepath.Join(home, "logs", slug+".log")
}

// StackLogTailOrError reads a stack's own combined log directly off disk and
// returns its last count lines, or an error naming the path it tried - the
// fallback for a timeout error message, since `haven logs` can itself fail
// on a stack that never became healthy (a real run printed "backend log
// unavailable: exit status 1" instead of the crash a person needed to see).
func StackLogTailOrError(slug string, count int) (string, error) {
	path := StackLogFile(slug)
	data, err := os.ReadFile(path) // #nosec G304 -- path is built from a slug this run allocated itself, plus an operator env override.
	if err != nil {
		return "", err
	}
	return LastLines(string(data), count), nil
}
