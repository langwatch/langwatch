package cmd

import (
	"context"
	"os"
	"path/filepath"

	"github.com/0xdeafcafe/moron/tui"
)

// runGitUI is `haven git [target]`: the embedded moron git TUI opened for the
// current worktree, a stack slug, a worktree name, or a directory — inspection
// across worktrees without cd-ing or checking anything out. Agents (and
// --json) get the plain per-worktree overview instead; a TUI is useless to
// them.
func runGitUI(_ context.Context, d deps, rest []string) error {
	if d.isAgent || hasFlag(rest, "--json") || hasFlag(rest, "--list") {
		return d.orch.GitOverview(d.worktree, d.isAgent || hasFlag(rest, "--json"))
	}

	target := firstNonFlag(rest)
	dir := d.worktree
	if target != "" {
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
	}
	return tui.Run(dir)
}
