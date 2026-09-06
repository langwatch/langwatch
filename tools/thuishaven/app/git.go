package app

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// GitTargetDir resolves what `haven git <target>` should open: a running
// stack's slug, or a known worktree's directory basename. Directory paths are
// resolved by the caller before this — the app core never stats the
// filesystem. An empty target is the caller's own worktree and never lands
// here.
func (o *Orchestrator) GitTargetDir(repoRoot, target string) (string, error) {
	var worktrees []Worktree
	var listErr error
	if o.hyg != nil {
		worktrees, listErr = o.hyg.Worktrees(repoRoot)
	}
	dir, err := ResolveGitTarget(o.store.Stacks(), worktrees, target)
	if err != nil && listErr != nil {
		return "", fmt.Errorf("%w (listing worktrees also failed: %v)", err, listErr)
	}
	return dir, err
}

// ResolveGitTarget picks the directory a target names: a registered stack's
// slug wins (it is what `haven list` shows), then a worktree's directory
// basename. Unknown targets fail with the full list of valid choices.
func ResolveGitTarget(stacks []domain.Stack, worktrees []Worktree, target string) (string, error) {
	var known []string
	for _, s := range stacks {
		if s.Slug == target {
			return s.WorktreeDir, nil
		}
		known = append(known, s.Slug)
	}
	for _, wt := range worktrees {
		if filepath.Base(wt.Dir) == target {
			return wt.Dir, nil
		}
		known = append(known, filepath.Base(wt.Dir))
	}
	return "", fmt.Errorf("no stack or worktree named %q (known: %s)", target, strings.Join(dedupe(known), ", "))
}

// gitWorktreeStatus is one row of the agent-facing overview: everything an
// agent (or a quick glance) needs to know about a worktree's git state.
type gitWorktreeStatus struct {
	Dir    string `json:"dir"`
	Name   string `json:"name"`
	Branch string `json:"branch"`
	Dirty  bool   `json:"dirty"`
	Up     bool   `json:"up"`
	Slug   string `json:"slug,omitempty"`
}

// GitOverview prints one line per worktree — branch, dirty state, stack up —
// the plain-text stand-in for the TUI when an agent (or --json) drives haven.
func (o *Orchestrator) GitOverview(repoRoot string, asJSON bool) error {
	if o.hyg == nil {
		return fmt.Errorf("hygiene adapter not wired")
	}
	worktrees, err := o.hyg.Worktrees(repoRoot)
	if err != nil {
		return fmt.Errorf("listing worktrees: %w", err)
	}
	live := o.liveWorktreeDirs()
	slugByDir := map[string]string{}
	for _, s := range o.store.Stacks() {
		slugByDir[s.WorktreeDir] = s.Slug
	}

	rows := make([]gitWorktreeStatus, 0, len(worktrees))
	for _, wt := range worktrees {
		rows = append(rows, gitWorktreeStatus{
			Dir:    wt.Dir,
			Name:   filepath.Base(wt.Dir),
			Branch: wt.Branch,
			Dirty:  o.hyg.Dirty(wt.Dir),
			Up:     live[wt.Dir],
			Slug:   slugByDir[wt.Dir],
		})
	}

	if asJSON {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		return enc.Encode(map[string]any{"worktrees": rows})
	}
	for _, r := range rows {
		state := "clean"
		if r.Dirty {
			state = "dirty"
		}
		up := "  "
		if r.Up {
			up = "up"
		}
		fmt.Printf("  %-28s %-40s %-6s %s\n", r.Name, r.Branch, state, up)
	}
	return nil
}

func dedupe(in []string) []string {
	seen := map[string]bool{}
	var out []string
	for _, s := range in {
		if s != "" && !seen[s] {
			seen[s] = true
			out = append(out, s)
		}
	}
	return out
}
