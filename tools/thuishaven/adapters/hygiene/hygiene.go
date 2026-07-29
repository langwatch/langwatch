// Package hygiene implements app.Hygiene: it enumerates a repo's git worktrees,
// checks them for uncommitted work, sizes and removes reclaimable build
// artefacts, and prunes orphaned git worktree admin entries. It is the only place
// haven touches the working tree destructively, so all of that lives behind one
// port with clear safety semantics (the app never removes a live or dirty tree).
package hygiene

import (
	"bufio"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/langwatch/langwatch/tools/thuishaven/app"
)

// Hygiene is the git + filesystem-backed implementation of app.Hygiene.
type Hygiene struct{}

// New returns a Hygiene.
func New() Hygiene { return Hygiene{} }

// Worktrees parses `git worktree list --porcelain` into (dir, branch) pairs.
func (Hygiene) Worktrees(repoRoot string) ([]app.Worktree, error) {
	out, err := exec.Command("git", "-C", repoRoot, "worktree", "list", "--porcelain").Output()
	if err != nil {
		return nil, err
	}
	var res []app.Worktree
	var cur app.Worktree
	sc := bufio.NewScanner(strings.NewReader(string(out)))
	for sc.Scan() {
		line := sc.Text()
		switch {
		case strings.HasPrefix(line, "worktree "):
			cur = app.Worktree{Dir: strings.TrimPrefix(line, "worktree ")}
		case strings.HasPrefix(line, "branch "):
			cur.Branch = strings.TrimPrefix(strings.TrimPrefix(line, "branch "), "refs/heads/")
		case line == "":
			if cur.Dir != "" {
				res = append(res, cur)
			}
			cur = app.Worktree{}
		}
	}
	if cur.Dir != "" {
		res = append(res, cur)
	}
	return res, nil
}

// Dirty reports whether a worktree has uncommitted changes (tracked or not).
func (Hygiene) Dirty(worktreeDir string) bool {
	out, err := exec.Command("git", "-C", worktreeDir, "status", "--porcelain").Output()
	if err != nil {
		return true // be conservative: if we can't tell, treat it as dirty
	}
	return strings.TrimSpace(string(out)) != ""
}

// DirSize returns the total bytes under path (following nothing, counting files),
// and whether it exists.
func (Hygiene) DirSize(path string) (int64, bool) {
	info, err := os.Lstat(path)
	if err != nil {
		return 0, false
	}
	if !info.IsDir() {
		return info.Size(), true
	}
	var total int64
	_ = filepath.WalkDir(path, func(_ string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if fi, err := d.Info(); err == nil && !d.IsDir() {
			total += fi.Size()
		}
		return nil
	})
	return total, true
}

// Remove deletes a path tree.
func (Hygiene) Remove(path string) error { return os.RemoveAll(path) }

// PruneGitWorktrees removes stale admin entries for worktrees whose directory is
// gone (safe: it never touches an existing working tree).
func (Hygiene) PruneGitWorktrees(repoRoot string) {
	_ = exec.Command("git", "-C", repoRoot, "worktree", "prune").Run()
}

// RemoveWorktree deletes a linked worktree, forcing past uncommitted changes
// (git requires --force twice for a dirty tree). The confirmation ceremony
// lives in the app layer — by the time this runs, the decision is made.
func (Hygiene) RemoveWorktree(repoRoot, dir string) error {
	out, err := exec.Command("git", "-C", repoRoot, "worktree", "remove", "--force", "--force", dir).CombinedOutput()
	if err != nil {
		return fmt.Errorf("git worktree remove: %w: %s", err, strings.TrimSpace(string(out)))
	}
	return nil
}
