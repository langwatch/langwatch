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
// default; only shouldAct=true removes anything. It never deletes a worktree, only its
// artefacts, and it always skips a worktree that is running or has uncommitted
// changes. It also prunes orphaned git worktree admin entries (always safe).
func (o *Orchestrator) Prune(ctx context.Context, repoRoot string, shouldAct bool) error {
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
				if shouldAct {
					if err := o.hyg.Remove(p); err != nil {
						o.log.Warn("prune: remove failed", zapErr(err))
					}
				}
			}
		}
		dropped := o.pruneDatabases(ctx, wt.Dir, shouldAct)
		if len(hits) == 0 && len(dropped) == 0 {
			continue
		}
		total += wtBytes
		reclaimed++
		verb := "would reclaim"
		if shouldAct {
			verb = "reclaimed    "
		}
		fmt.Printf("  %s %-30s %8s  %v\n", verb, filepath.Base(wt.Dir), humanBytes(wtBytes), hits)
		if len(dropped) > 0 {
			dbVerb := "would drop database"
			if shouldAct {
				dbVerb = "dropped database   "
			}
			fmt.Printf("  %s %-30s %v\n", dbVerb, filepath.Base(wt.Dir), dropped)
		}
	}

	o.hyg.PruneGitWorktrees(repoRoot)

	fmt.Printf("\n%d worktree(s) with reclaimable disk, %d skipped (up/dirty).\n", reclaimed, skipped)
	if shouldAct {
		fmt.Printf("Reclaimed ~%s.\n", humanBytes(total))
	} else {
		fmt.Printf("Would reclaim ~%s. Re-run with --yes to act.\n", humanBytes(total))
	}
	return nil
}

// pruneDatabases drops a pruned worktree's ClickHouse + Postgres databases —
// a pruned worktree's data has no readers left, so lingering connections are
// terminated rather than respected. It only touches databases haven itself
// named: the worktree must have a cached slug (written by `up`), so a checkout
// that never ran a stack is never guessed at. Returns what was (or would be)
// dropped.
func (o *Orchestrator) pruneDatabases(ctx context.Context, worktreeDir string, shouldAct bool) []string {
	slug, ok := o.store.ReadSlugCache(worktreeDir)
	if !ok || slug == "" {
		return nil
	}
	db := domain.DatabaseForSlug(slug)
	if domain.IsProtectedDatabase(db) {
		return nil
	}

	var dropped []string
	if o.ch != nil && o.cfg.ShouldManageClickHouse {
		if dbs, err := o.ch.Databases(ctx); err == nil && contains(dbs, db) {
			if shouldAct {
				if err := o.ch.DropDatabase(ctx, db); err != nil {
					o.log.Warn("prune: clickhouse drop failed", zapErr(err))
				} else {
					dropped = append(dropped, db+" (clickhouse)")
				}
			} else {
				dropped = append(dropped, db+" (clickhouse)")
			}
		}
	}
	if o.pg != nil && o.cfg.ShouldManagePostgres {
		if dbs, err := o.pg.Databases(ctx); err == nil && contains(dbs, db) {
			if shouldAct {
				if err := o.pg.DropDatabase(ctx, db); err != nil {
					o.log.Warn("prune: postgres drop failed", zapErr(err))
				} else {
					dropped = append(dropped, db+" (postgres)")
				}
			} else {
				dropped = append(dropped, db+" (postgres)")
			}
		}
	}
	return dropped
}

func contains(list []string, s string) bool {
	for _, v := range list {
		if v == s {
			return true
		}
	}
	return false
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
