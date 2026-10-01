package domain

import "path/filepath"

// HavenLogsRoot is where a worktree's own logs live: <worktree>/.haven/logs
// (ruling 2026-09-29). It is rooted in the checkout or worktree the stack runs
// from, not the shared haven home, so removing that directory — a `haven
// destroy`, or an apidiff/visualdiff run simply deleting its own worktree —
// takes every log it ever wrote with it.
func HavenLogsRoot(worktreeDir string) string {
	return filepath.Join(worktreeDir, ".haven", "logs")
}

// StackLogPaths is where one stack's logs live under HavenLogsRoot: dir is its
// per-service capture directory (and job journal), combined is the single file
// a detached `haven up` streams its own output into.
func StackLogPaths(worktreeDir, slug string) (dir, combined string) {
	root := HavenLogsRoot(worktreeDir)
	return filepath.Join(root, slug), filepath.Join(root, slug+".log")
}
