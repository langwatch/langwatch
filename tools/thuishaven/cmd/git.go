package cmd

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/0xdeafcafe/moron/tui"
)

// runGitUI is `haven git [target]`: the embedded moron git TUI opened for the
// current worktree, a stack slug, a worktree name, or a directory — inspection
// across worktrees without cd-ing or checking anything out. Agents (and
// --json) get the plain per-worktree overview instead; a TUI is useless to
// them.
func runGitUI(_ context.Context, d deps, rest []string) error {
	if d.isAgent || hasFlag(rest, "--json") || hasFlag(rest, "--list") {
		if firstNonFlag(rest) != "" {
			return fmt.Errorf("targets are not supported with --list/--json")
		}
		return d.orch.GitOverview(d.worktree, d.isAgent || hasFlag(rest, "--json"))
	}

	target := firstNonFlag(rest)
	dir := d.worktree
	if target != "" {
		// A registered slug always wins over a same-named local directory: only
		// treat the target as a filesystem path when it is path-like (contains a
		// path separator or starts with ./, ../, /, or ~). Bare names resolve
		// exclusively through the orchestrator so `haven git <slug>` can't be
		// shadowed by whatever ./<slug> directory happens to sit in the cwd.
		if isPathLike(target) {
			if st, err := os.Stat(target); err == nil && st.IsDir() {
				if abs, err := filepath.Abs(target); err == nil {
					dir = abs
				} else {
					dir = target
				}
			} else {
				resolved, err := d.orch.GitTargetDir(d.worktree, target)
				if err != nil {
					return err
				}
				dir = resolved
			}
		} else {
			resolved, err := d.orch.GitTargetDir(d.worktree, target)
			if err != nil {
				return err
			}
			dir = resolved
		}
	}
	return tui.Run(dir)
}

// isPathLike reports whether target names a filesystem path rather than a bare
// stack slug or worktree name — it contains a path separator or starts with a
// relative/absolute/home prefix (./, ../, /, ~).
func isPathLike(target string) bool {
	return strings.ContainsRune(target, filepath.Separator) ||
		strings.HasPrefix(target, "./") ||
		strings.HasPrefix(target, "../") ||
		strings.HasPrefix(target, "/") ||
		strings.HasPrefix(target, "~")
}
