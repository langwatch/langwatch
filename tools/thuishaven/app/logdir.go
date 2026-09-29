package app

import (
	"os"
	"path/filepath"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// LogDir and LogPath resolve a stack's logs for reading, by slug, the one way
// every reader (the dashboard, `haven logs`, the up viewer) does it: from the
// registry entry's own worktree, under domain.HavenLogsRoot (ruling
// 2026-09-29). A stack that started before this change and is still writing to
// the pre-ruling global home is found there instead, so a live stack's logs
// are never orphaned mid-run.
func (o *Orchestrator) LogDir(slug string) string {
	dir, _ := o.resolveLogPaths(slug)
	return dir
}

// LogPath is the sibling of LogDir: the combined single file a detached
// `haven up` streams into.
func (o *Orchestrator) LogPath(slug string) string {
	_, combined := o.resolveLogPaths(slug)
	return combined
}

func (o *Orchestrator) resolveLogPaths(slug string) (dir, combined string) {
	oldDir := filepath.Join(o.cfg.Home, "logs", slug)
	oldCombined := filepath.Join(o.cfg.Home, "logs", slug+".log")
	st, ok := o.stackBySlug(slug)
	if !ok || st.WorktreeDir == "" {
		return oldDir, oldCombined
	}
	dir, combined = domain.StackLogPaths(st.WorktreeDir, slug)
	if !dirHasEntries(dir) && dirHasEntries(oldDir) {
		return oldDir, oldCombined
	}
	return dir, combined
}

// dirHasEntries reports whether logs were ever written there — the cheap check
// behind the old-home fallback above.
func dirHasEntries(dir string) bool {
	entries, err := os.ReadDir(dir)
	return err == nil && len(entries) > 0
}
