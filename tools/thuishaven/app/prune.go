package app

import (
	"context"
	"fmt"
	"path/filepath"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// Prune reclaims regenerable local-dev disk (node_modules + build caches) from
// worktrees that are safe to touch — neither up nor dirty. It is dry-run by
// default; only act=true removes anything. It never deletes a worktree, only its
// artefacts, and it always skips a worktree that is running or has uncommitted
// changes. It also prunes orphaned git worktree admin entries (always safe).
func (o *Orchestrator) Prune(ctx context.Context, repoRoot string, act bool) error {
	if o.hyg == nil {
		return fmt.Errorf("hygiene adapter not wired")
	}
	worktrees, err := o.hyg.Worktrees(repoRoot)
	if err != nil {
		return fmt.Errorf("listing worktrees: %w", err)
	}
	live := o.liveWorktreeDirs()

	var reclaimed, skipped int
	var total int64
	for _, wt := range worktrees {
		if live[wt.Dir] {
			fmt.Printf("  skip  %-40s (up)\n", filepath.Base(wt.Dir))
			skipped++
			continue
		}
		if o.hyg.Dirty(wt.Dir) {
			fmt.Printf("  skip  %-40s (uncommitted changes)\n", filepath.Base(wt.Dir))
			skipped++
			continue
		}
		var wtBytes int64
		var hits []string
		for _, rel := range domain.ReclaimablePaths {
			p := filepath.Join(wt.Dir, rel)
			if size, ok := o.hyg.DirSize(p); ok {
				wtBytes += size
				hits = append(hits, rel)
				if act {
					if err := o.hyg.Remove(p); err != nil {
						o.log.Warn("prune: remove failed", zapErr(err))
					}
				}
			}
		}
		if len(hits) == 0 {
			continue
		}
		total += wtBytes
		reclaimed++
		verb := "would reclaim"
		if act {
			verb = "reclaimed    "
		}
		fmt.Printf("  %s %-30s %8s  %v\n", verb, filepath.Base(wt.Dir), humanBytes(wtBytes), hits)
	}

	o.hyg.PruneGitWorktrees(repoRoot)

	fmt.Printf("\n%d worktree(s) with reclaimable disk, %d skipped (up/dirty).\n", reclaimed, skipped)
	if act {
		fmt.Printf("Reclaimed ~%s.\n", humanBytes(total))
	} else {
		fmt.Printf("Would reclaim ~%s. Re-run with --yes to act.\n", humanBytes(total))
	}
	return nil
}

// liveWorktreeDirs is the set of worktree dirs with a running stack.
func (o *Orchestrator) liveWorktreeDirs() map[string]bool {
	live := map[string]bool{}
	for _, s := range o.store.Stacks() {
		if o.sys.ProcessAlive(s.LauncherPID) {
			live[s.WorktreeDir] = true
		}
	}
	return live
}

func zapErr(err error) zap.Field { return zap.Error(err) }

func humanBytes(b int64) string {
	const unit = 1024
	if b < unit {
		return fmt.Sprintf("%dB", b)
	}
	div, exp := int64(unit), 0
	for n := b / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f%cB", float64(b)/float64(div), "KMGTPE"[exp])
}
