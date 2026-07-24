package app

import (
	"context"
	"fmt"
	"path/filepath"
	"slices"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// Prune reclaims regenerable local-dev disk (node_modules + build caches) from
// worktrees that are safe to touch — neither up nor dirty. It is dry-run by
// default; only shouldAct=true removes anything. It never deletes a worktree, only its
// artefacts, and it always skips a worktree that is running or has uncommitted
// changes. A safe worktree's slug-cached ClickHouse + Postgres databases are also
// dropped (the protected main database, lw_main, is always kept) — unlike the disk
// artefacts these are not regenerable, so the same up/dirty and slug guards apply.
// It also prunes orphaned git worktree admin entries (always safe).
func (o *Orchestrator) Prune(ctx context.Context, repoRoot string, shouldAct bool) error {
	if o.hyg == nil {
		return fmt.Errorf("hygiene adapter not wired")
	}
	worktrees, err := o.hyg.Worktrees(repoRoot)
	if err != nil {
		return fmt.Errorf("listing worktrees: %w", err)
	}
	// Canonicalise both sides of the liveness comparison so a symlinked or
	// case-variant path (macOS /var vs /private/var) cannot defeat the up-guard and
	// let prune drop a running worktree's databases.
	live := map[string]bool{}
	for _, s := range o.store.Stacks() {
		if o.sys.ProcessAlive(s.LauncherPID) {
			live[canonicalPath(s.WorktreeDir)] = true
		}
	}

	// List each managed server's databases once, up front, rather than per
	// candidate worktree: a stopped server (common at prune time) is surfaced
	// instead of silently skipped, and N worktrees no longer pay N×2 server calls.
	var chDBs, pgDBs []string
	if o.ch != nil && o.cfg.ShouldManageClickHouse {
		if dbs, err := o.ch.Databases(ctx); err == nil {
			chDBs = dbs
		} else {
			o.log.Warn("prune: clickhouse database listing failed", zapErr(err))
			fmt.Println("  database reclaim skipped — clickhouse unreachable")
		}
	}
	if o.pg != nil && o.cfg.ShouldManagePostgres {
		if dbs, err := o.pg.Databases(ctx); err == nil {
			pgDBs = dbs
		} else {
			o.log.Warn("prune: postgres database listing failed", zapErr(err))
			fmt.Println("  database reclaim skipped — postgres unreachable")
		}
	}

	var reclaimed, skipped int
	var total int64
	for _, wt := range worktrees {
		if live[canonicalPath(wt.Dir)] {
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
		dropped := o.pruneDatabases(ctx, wt.Dir, shouldAct, chDBs, pgDBs)
		if len(hits) == 0 && len(dropped) == 0 {
			continue
		}
		// The disk-reclaim line and its byte tally count only worktrees that
		// actually had reclaimable disk; a database-only prune prints its own line
		// below without inflating the reclaimable-disk total.
		if len(hits) > 0 {
			total += wtBytes
			reclaimed++
			verb := "would reclaim"
			if shouldAct {
				verb = "reclaimed    "
			}
			fmt.Printf("  %s %-30s %8s  %v\n", verb, filepath.Base(wt.Dir), domain.HumanBytes(wtBytes), hits)
		}
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
		fmt.Printf("Reclaimed ~%s.\n", domain.HumanBytes(total))
	} else {
		fmt.Printf("Would reclaim ~%s. Re-run with --yes to act.\n", domain.HumanBytes(total))
	}
	return nil
}

// pruneDatabases drops a pruned worktree's ClickHouse + Postgres databases —
// a pruned worktree's data has no readers left, so lingering connections are
// terminated rather than respected. It only touches databases haven itself
// named: the worktree must have a cached slug (written by `up`), so a checkout
// that never ran a stack is never guessed at. The cached slug is validated (it is
// the one slug source fed straight into DDL builders) and a database still owned
// by a live registered stack is never dropped, so a stale or forged .langwatch-slug
// cannot redirect the drop at a running worktree's data. The server database lists
// are fetched once by Prune and passed in. Returns what was (or would be) dropped.
func (o *Orchestrator) pruneDatabases(ctx context.Context, worktreeDir string, shouldAct bool, chDBs, pgDBs []string) []string {
	slug, ok := o.store.ReadSlugCache(worktreeDir)
	if !ok || slug == "" {
		return nil
	}
	// resolveSlug gates this same cache behind ValidSlug; pruneDatabases must too,
	// or raw .langwatch-slug content reaches DatabaseForSlug and the DDL builders.
	if !domain.ValidSlug(slug) {
		return nil
	}
	// Liveness is keyed by worktree dir, but a stale or forged slug cache can name
	// a slug a *different*, still-running stack owns; refuse to drop a database any
	// live registered stack still claims.
	for _, st := range o.store.Stacks() {
		if st.Slug == slug && o.sys.ProcessAlive(st.LauncherPID) {
			return nil
		}
	}
	db := domain.DatabaseForSlug(slug)
	if domain.IsProtectedDatabase(db) {
		fmt.Printf("kept %q (protected — the standing main database)\n", db)
		return nil
	}

	var dropped []string
	if o.ch != nil && o.cfg.ShouldManageClickHouse && slices.Contains(chDBs, db) {
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
	if o.pg != nil && o.cfg.ShouldManagePostgres && slices.Contains(pgDBs, db) {
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
	return dropped
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
