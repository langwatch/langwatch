package app

import (
	"context"
	"fmt"
	"slices"
	"sync"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// DefaultStaleThreshold is how long a worktree must have sat idle before
// interactive prune pre-selects it for deletion. Five days keeps a week's active
// branches untouched while catching the long tail that silts a machine up.
const DefaultStaleThreshold = 5 * 24 * time.Hour

// The two scan queues run at different widths on purpose. The meta queue is git
// + in-memory lookups (cheap), so it runs wide and lands almost immediately; the
// size queue shells out to `du` over each whole tree (node_modules dominates), so
// it runs narrower to avoid thrashing the disk and trickles in behind the meta.
const (
	metaScanSlots = 16
	sizeScanSlots = 8
)

// PruneRow is one worktree as interactive prune considers it. The identity and
// guard facts (primary / current / live) are known up front from `git worktree
// list` and the registry; the footprint is filled in separately by ScanWorktrees.
type PruneRow struct {
	Dir    string
	Branch string
	// Slug is the registry-authoritative slug whose databases deleting this
	// worktree would drop, or "" when none can be safely resolved. Derived the same
	// way DestroyWorktree derives it, so a forged .langwatch-slug can't redirect it.
	Slug      string
	IsPrimary bool // git's primary checkout — never deletable
	IsCurrent bool // the worktree haven is running from — never deletable
	IsLive    bool // a registered stack's launcher is alive
}

// Deletable reports whether interactive prune may ever remove this worktree. The
// primary checkout and the current worktree are hard-protected — the same two
// targets DestroyWorktree refuses — so ticking them is impossible, not merely
// discouraged. Everything else is fair game once the user selects it.
func (r PruneRow) Deletable() bool { return !r.IsPrimary && !r.IsCurrent }

// PruneMeta is a worktree's cheap-to-detect facts: which per-slug databases it
// owns, how long it has sat idle, and whether its branch's upstream was deleted.
// It is everything the default pre-selection needs, and it lands fast — before the
// size, which is measured separately.
type PruneMeta struct {
	HasCHDB    bool          // this worktree owns an lw_<slug> ClickHouse database
	HasPGDB    bool          // this worktree owns an lw_<slug> Postgres database
	RedisDB    int           // this worktree's Redis DB index (0-15), -1 when unknown
	IsDirty    bool          // uncommitted changes — never default-selected
	OriginGone bool          // the branch's upstream ref was deleted (merged + pruned)
	LastActive time.Time     // when the worktree was last worked on (zero = unknown)
	StaleFor   time.Duration // now - LastActive, clamped at 0 (0 when LastActive is unknown)
}

// PlanPrune enumerates the repo's worktrees and computes each one's cheap identity
// and guard facts (primary / current / live) plus the slug whose databases a
// delete may drop. The footprint — databases, staleness, disk size — is left to
// ScanWorktrees. selfDir is the worktree haven was launched from; it and the
// primary checkout are marked non-deletable here and refused again in
// DestroyWorktree, so the guard holds even if the caller ignores Deletable.
func (o *Orchestrator) PlanPrune(repoRoot, selfDir string) ([]PruneRow, error) {
	if o.hyg == nil {
		return nil, fmt.Errorf("hygiene adapter not wired")
	}
	worktrees, err := o.hyg.Worktrees(repoRoot)
	if err != nil {
		return nil, fmt.Errorf("listing worktrees: %w", err)
	}
	// Canonicalise both sides of every identity comparison so a symlinked or
	// case-variant path can't defeat the live-, self-, or primary-guard.
	live := map[string]bool{}
	for _, s := range o.store.Stacks() {
		if o.sys.ProcessAlive(s.LauncherPID) {
			live[canonicalPath(s.WorktreeDir)] = true
		}
	}
	selfCanon := canonicalPath(selfDir)

	rows := make([]PruneRow, 0, len(worktrees))
	for i, wt := range worktrees {
		canon := canonicalPath(wt.Dir)
		rows = append(rows, PruneRow{
			Dir:    wt.Dir,
			Branch: wt.Branch,
			// resolveDestroySlug expects an already-canonicalised dir (DestroyWorktree
			// canonicalises before calling it) — pass the same here.
			Slug: o.resolveDestroySlug(canon),
			// worktrees[0] is git's primary checkout: `git worktree list` always emits
			// it first. The same ordering DestroyWorktree's primary-guard relies on.
			IsPrimary: i == 0,
			IsCurrent: canon == selfCanon,
			IsLive:    live[canon],
		})
	}
	return rows, nil
}

// ScanWorktrees fills in each row's footprint using two independent concurrent
// queues at once: the fast meta pass (see ScanMeta) and the slow size pass (see
// ScanSizes). Splitting them means idle time and the default pre-selection are
// ready almost immediately while the sizes trickle in behind — the loading state
// fills in two passes, not one slow one. Either callback may be nil, and each runs
// from a scan goroutine, so both must be safe to call concurrently. It blocks until
// both passes finish; ctx cancellation stops them. The interactive picker uses
// this; the non-interactive report uses ScanMeta alone, so it need not wait on du.
func (o *Orchestrator) ScanWorktrees(ctx context.Context, rows []PruneRow, onMeta func(index int, meta PruneMeta), onSize func(index int, bytes int64)) {
	var wg sync.WaitGroup
	wg.Add(2)
	go func() { defer wg.Done(); o.ScanMeta(ctx, rows, onMeta) }()
	go func() { defer wg.Done(); o.ScanSizes(ctx, rows, onSize) }()
	wg.Wait()
}

// ScanMeta runs the fast queue: git + in-memory database lookups per worktree,
// feeding onMeta as each lands. It is everything the default pre-selection needs,
// and it finishes in seconds even across a large fleet — so both the picker and
// the non-interactive report can rank and pre-select long before any size is known.
func (o *Orchestrator) ScanMeta(ctx context.Context, rows []PruneRow, onMeta func(index int, meta PruneMeta)) {
	if onMeta == nil {
		return
	}
	chDBs, pgDBs := o.scanDatabaseLists(ctx)
	now := o.sys.Now()
	o.scanPass(ctx, len(rows), metaScanSlots, func(i int) {
		onMeta(i, o.scanMeta(rows[i], chDBs, pgDBs, now))
	})
}

// ScanSizes runs the slow queue: `du` over each whole worktree tree, feeding
// onSize as each size lands. It is the multi-second-per-worktree part, so it runs
// on its own so the fast facts never wait behind it.
func (o *Orchestrator) ScanSizes(ctx context.Context, rows []PruneRow, onSize func(index int, bytes int64)) {
	if onSize == nil {
		return
	}
	o.scanPass(ctx, len(rows), sizeScanSlots, func(i int) {
		// Protected worktrees are never reclaimed, so their size is never shown —
		// and the primary checkout's tree contains every other worktree (they live
		// under its .claude/worktrees/), so sizing it would both double-count and be
		// the single most expensive walk. Skip them.
		if !rows[i].Deletable() {
			return
		}
		if b, ok := o.hyg.DiskUsage(rows[i].Dir); ok {
			onSize(i, b)
		}
	})
}

// scanPass runs work(i) for every index 0..n-1 with at most slots running at
// once, and returns when all have finished. It is the shared shape both scan
// queues take — they differ only in width and in the work they do per index.
func (o *Orchestrator) scanPass(ctx context.Context, n, slots int, work func(i int)) {
	sem := make(chan struct{}, slots)
	var wg sync.WaitGroup
	for i := range n {
		if ctx.Err() != nil {
			break
		}
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			if ctx.Err() != nil {
				return
			}
			work(i)
		}(i)
	}
	wg.Wait()
}

// scanMeta computes one worktree's cheap facts. It never starts a server: the
// database lists are the ones fetched once by ScanWorktrees, so an unreachable
// server simply yields "no database" rather than a per-row stall.
func (o *Orchestrator) scanMeta(row PruneRow, chDBs, pgDBs []string, now time.Time) PruneMeta {
	meta := PruneMeta{RedisDB: -1}
	meta.IsDirty = o.hyg.Dirty(row.Dir)
	meta.OriginGone = o.hyg.UpstreamGone(row.Dir, row.Branch)
	if t, ok := o.hyg.LastActivity(row.Dir); ok && !t.IsZero() {
		meta.LastActive = t
		if d := now.Sub(t); d > 0 {
			meta.StaleFor = d
		}
	}
	// A worktree only owns per-slug databases if it has a valid, unprotected slug —
	// the same gate pruneDatabases applies before touching any DDL.
	if row.Slug != "" && domain.ValidSlug(row.Slug) {
		db := domain.DatabaseForSlug(row.Slug)
		if !domain.IsProtectedDatabase(db) {
			meta.HasCHDB = o.cfg.ShouldManageClickHouse && slices.Contains(chDBs, db)
			meta.HasPGDB = o.cfg.ShouldManagePostgres && slices.Contains(pgDBs, db)
			meta.RedisDB = domain.RedisDBForSlug(row.Slug)
		}
	}
	return meta
}

// scanDatabaseLists fetches the managed servers' database lists once for a scan.
// Unlike Prune's own listing it is log-only (no stdout), so it can never corrupt
// the interactive picker mid-draw; an unreachable server just yields an empty list
// and every row reports no database for that engine.
func (o *Orchestrator) scanDatabaseLists(ctx context.Context) (chDBs, pgDBs []string) {
	if o.ch != nil && o.cfg.ShouldManageClickHouse {
		if dbs, err := o.ch.Databases(ctx); err == nil {
			chDBs = dbs
		} else {
			o.log.Warn("prune scan: clickhouse database listing failed", zapErr(err))
		}
	}
	if o.pg != nil && o.cfg.ShouldManagePostgres {
		if dbs, err := o.pg.Databases(ctx); err == nil {
			pgDBs = dbs
		} else {
			o.log.Warn("prune scan: postgres database listing failed", zapErr(err))
		}
	}
	return
}

// DefaultSelected reports whether a worktree should be pre-ticked for deletion: it
// must be deletable (not the primary or current worktree), not running, not dirty
// (deleting a worktree with uncommitted changes is only ever a deliberate,
// hand-ticked act), and idle for at least threshold. It reads only the meta pass,
// so pre-selection is ready before any size is measured. Live and dirty worktrees
// can still be selected by hand — this decides the default, not what is permitted.
func DefaultSelected(row PruneRow, meta PruneMeta, threshold time.Duration) bool {
	return row.Deletable() &&
		!row.IsLive &&
		!meta.IsDirty &&
		!meta.LastActive.IsZero() &&
		meta.StaleFor >= threshold
}
