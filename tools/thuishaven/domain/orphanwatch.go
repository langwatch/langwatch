package domain

import (
	"path/filepath"
	"slices"
	"strings"
	"time"
)

// The orphan sweep: dev tooling a checkout started that outlived whatever
// owned it. Two rules, both scoped to a LangWatch checkout (cwd or command
// path under a root): a PPID-1 tree of node/pnpm/vite/tsc/a `sh -c` restart
// loop older than Grace, and a compiler run older than TypecheckMaxAge under
// any parent. Decisions here are pure; the daemon samples and signals.

// OrphanClass is the reap Kind of everything this sweep reclaims.
const OrphanClass = "orphans"

// OrphanLimits bound how long unowned dev tooling may live. Zero disables a rule.
type OrphanLimits struct {
	Grace           time.Duration // a PPID-1 checkout process younger than this is left alone
	KillGrace       time.Duration // SIGTERM to SIGKILL
	TypecheckMaxAge time.Duration // a compiler run older than this is reaped, any parent
	Every           time.Duration // sweep cadence
}

// DefaultOrphanLimits are conservative: ten minutes covers any hand-over or
// restart gap, and 45 minutes is well past a whole-tree typecheck.
func DefaultOrphanLimits() OrphanLimits {
	return OrphanLimits{Grace: 10 * time.Minute, KillGrace: 30 * time.Second, TypecheckMaxAge: 45 * time.Minute, Every: time.Minute}
}

// orphanBinaries are the dev-tooling binaries an orphaned checkout tree runs.
var orphanBinaries = []string{
	"node", "tsx", "tsc", "tsgo", "vitest", "vite", "pnpm", "pnpm-native", "npm", "npx", "esbuild",
}

// orphanShells are matched only as `<shell> -c …`: a script, never a login or
// interactive shell.
var orphanShells = []string{"sh", "bash", "zsh", "dash"}

// orphanNever are words that mark a process as somebody's session or haven
// itself, however it was launched.
var orphanNever = []string{"claude", "codex", "haven", "--lsp", "tsserver", "language-server", "Visual Studio Code", "Cursor", "/Zed"}

// IsOrphanCandidate reports whether a PPID-1 command is dev tooling the sweep
// may reclaim. The Nx daemon is excluded: reapOrphanNxDaemons owns it.
func IsOrphanCandidate(command string) bool {
	if command == "" || containsWord(command, orphanNever) {
		return false
	}
	if _, isNx := NxDaemonWorktree(command); isNx {
		return false
	}
	fields := strings.Fields(command)
	base := binaryBase(command)
	if slices.Contains(orphanShells, base) {
		return len(fields) > 1 && (fields[1] == "-c" || fields[1] == "-lc")
	}
	return slices.Contains(orphanBinaries, base)
}

// IsLongTypecheckCandidate reports whether command is a TypeScript compiler run
// (by binary or by script path), never a language server or a watcher.
func IsLongTypecheckCandidate(command string) bool {
	if containsWord(command, orphanNever) || strings.Contains(command, "--watch") || slices.Contains(strings.Fields(command), "-w") {
		return false
	}
	for i, word := range strings.Fields(command) {
		if i > 1 {
			break // the binary, or the script a node binary runs
		}
		if isTypeScriptCompilerBinary(filepath.Base(word)) {
			return true
		}
	}
	return false
}

// UnderRoots reports whether path is a root or sits beneath one.
func UnderRoots(path string, roots []string) bool {
	if path == "" {
		return false
	}
	path = filepath.Clean(path)
	for _, root := range roots {
		if root == "" {
			continue
		}
		root = filepath.Clean(root)
		if path == root || strings.HasPrefix(path, root+string(filepath.Separator)) {
			return true
		}
	}
	return false
}

// MentionsRoot reports whether command names a path under one of the roots.
func MentionsRoot(command string, roots []string) bool {
	for _, word := range strings.Fields(command) {
		if strings.HasPrefix(word, "/") && UnderRoots(word, roots) {
			return true
		}
	}
	return false
}

func containsWord(command string, words []string) bool {
	for _, w := range words {
		if strings.Contains(command, w) {
			return true
		}
	}
	return false
}
