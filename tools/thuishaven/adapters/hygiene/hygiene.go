// Package hygiene implements app.Hygiene: it enumerates a repo's git worktrees,
// checks them for uncommitted work, sizes and removes reclaimable build
// artefacts, and prunes orphaned git worktree admin entries. It is the only place
// haven touches the working tree destructively, so all of that lives behind one
// port with clear safety semantics (the app never removes a live or dirty tree).
package hygiene

import (
	"bufio"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

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

// LastActivity reports when a worktree was last worked on: the committer date of
// its checked-out HEAD (the clearest "how long has this branch sat" signal),
// falling back to the worktree directory's own mtime when there is no commit to
// read — a fresh checkout, or a detached/unborn HEAD. The bool is false only when
// neither can be established.
func (Hygiene) LastActivity(worktreeDir string) (time.Time, bool) {
	out, err := exec.Command("git", "-C", worktreeDir, "log", "-1", "--format=%ct", "HEAD").Output()
	if err == nil {
		if secs, perr := strconv.ParseInt(strings.TrimSpace(string(out)), 10, 64); perr == nil && secs > 0 {
			return time.Unix(secs, 0), true
		}
	}
	if fi, serr := os.Stat(worktreeDir); serr == nil {
		return fi.ModTime(), true
	}
	return time.Time{}, false
}

// DiskUsage returns how much disk a path occupies, via `du -sk` — far faster than
// a Go tree-walk on a big worktree (node_modules), which is what the prune picker
// sizes across every worktree at once. It reports allocated blocks (KiB), the
// "space you'd actually get back". The exit code is deliberately ignored: du exits
// non-zero when it hits an unreadable subdirectory (permission denied, or a file
// that vanished mid-walk) yet still prints a usable grand total to stdout — so the
// verdict is "did it print a number", not "did it exit 0". ok=false only when
// there is nothing to parse (the path is gone, du is missing, or ctx was cancelled
// mid-walk — CommandContext kills the du process, and a killed du prints nothing).
func (Hygiene) DiskUsage(ctx context.Context, path string) (int64, bool) {
	out, _ := exec.CommandContext(ctx, "du", "-sk", path).Output()
	fields := strings.Fields(string(out))
	if len(fields) == 0 {
		return 0, false
	}
	kb, perr := strconv.ParseInt(fields[0], 10, 64)
	if perr != nil {
		return 0, false
	}
	return kb * 1024, true
}

// UpstreamGone reports whether branch tracks an upstream whose remote-tracking
// ref is gone (`git fetch --prune` removed it after the remote branch was
// deleted). It reads the ref state with for-each-ref rather than `git status`, so
// it does not scan the working tree — cheap enough to run across every worktree.
// The %(upstream:track) field is git's own "[gone]" verdict; nobracket strips the
// brackets. Empty branch (detached HEAD) or no upstream reads as not-gone.
func (Hygiene) UpstreamGone(worktreeDir, branch string) bool {
	if branch == "" {
		return false
	}
	out, err := exec.Command("git", "-C", worktreeDir,
		"for-each-ref", "--format=%(upstream:track,nobracket)", "refs/heads/"+branch).Output()
	if err != nil {
		return false
	}
	return strings.TrimSpace(string(out)) == "gone"
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
