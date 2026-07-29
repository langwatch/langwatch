package app

import (
	"context"
	"fmt"
	"path/filepath"
	"slices"
	"time"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// processDeathWait bounds how long DestroyWorktree waits for a downed launcher
// to actually exit before it drops databases and removes the directory;
// processDeathPoll is how often it re-checks in that window.
const (
	processDeathWait = 5 * time.Second
	processDeathPoll = 50 * time.Millisecond
)

// DownStack stops a registered stack by slug, from anywhere: it terminates the
// launcher (the supervised children die with their process group), removes the
// stack's routes, and drops its registry entry. Databases are deliberately
// kept — stopping someone's stack from the hub must not silently discard their
// data; that is what DestroyWorktree is for.
func (o *Orchestrator) DownStack(ctx context.Context, slug string) error {
	st, ok := o.stackBySlug(slug)
	if !ok {
		return fmt.Errorf("no registered stack %q", slug)
	}
	if o.sys.ProcessAlive(st.LauncherPID) {
		o.sys.Terminate(st.LauncherPID)
	}
	for _, svc := range st.Services {
		o.proxy.Remove(svc.Name, slug)
	}
	o.store.RemoveStack(slug)
	return nil
}

// DestroyWorktree is the hub's full wipe: stop any stack running from the
// worktree, drop its ClickHouse + Postgres databases (the protected main
// database is always kept), and remove the worktree directory itself — even a
// dirty one, because the caller has already confirmed by typing the name. Two
// targets are never destroyable: the repository's primary checkout and the
// worktree haven itself was launched from (selfDir).
func (o *Orchestrator) DestroyWorktree(ctx context.Context, gitDir, dir, selfDir string) error {
	if o.hyg == nil {
		return fmt.Errorf("hygiene adapter not wired")
	}
	worktrees, err := o.hyg.Worktrees(gitDir)
	if err != nil {
		return fmt.Errorf("listing worktrees: %w", err)
	}
	// Canonicalise before every identity comparison: a symlinked or case-variant
	// path (macOS /tmp→/private/tmp, case-insensitive FS) must not slip past the
	// primary-checkout or self-dir guards by naming the same directory differently.
	dir = canonicalPath(dir)
	selfDir = canonicalPath(selfDir)
	// worktrees[0] is git's main worktree: `git worktree list` always emits the
	// primary checkout first, before any linked worktrees. A refactor that sorts
	// or filters this list must preserve that ordering (or expose IsPrimary from
	// the porcelain parse) or this guard silently stops protecting the primary.
	if len(worktrees) > 0 && canonicalPath(worktrees[0].Dir) == dir {
		return fmt.Errorf("refusing to destroy %s — it is the repository's primary checkout", dir)
	}
	if dir == selfDir {
		return fmt.Errorf("refusing to destroy %s — haven is running from it", dir)
	}
	if !isKnownWorktree(worktrees, dir) {
		return fmt.Errorf("%s is not a worktree of this repository", dir)
	}

	// Resolve the slug whose databases we may drop from the registry (which haven
	// controls) rather than the worktree-local slug cache (which a hostile branch
	// can forge) — do it before downing, while the registry entries still exist.
	dbSlug := o.resolveDestroySlug(dir)

	var downedPIDs []int
	for _, st := range o.store.Stacks() {
		if canonicalPath(st.WorktreeDir) != dir {
			continue
		}
		downedPIDs = append(downedPIDs, st.LauncherPID)
		if err := o.DownStack(ctx, st.Slug); err != nil {
			o.log.Warn("destroy: down failed (continuing)", zap.String("slug", st.Slug), zap.Error(err))
		}
	}
	// DownStack signals the launchers asynchronously (they die with their process
	// group); wait for them to actually exit before touching the databases or the
	// directory, so RemoveWorktree does not race a node/vite stack still writing.
	o.waitForProcessesDead(downedPIDs)

	o.dropWorktreeDatabases(ctx, dbSlug)
	if err := o.hyg.RemoveWorktree(gitDir, dir); err != nil {
		return fmt.Errorf("removing worktree: %w", err)
	}
	o.hyg.PruneGitWorktrees(gitDir)
	return nil
}

// resolveDestroySlug picks the slug whose databases DestroyWorktree may drop.
// The registry is authoritative: a stack registered for dir carries the slug
// haven itself assigned, so it wins over the worktree-local slug cache
// (.langwatch-slug), which a hostile branch checked out via `haven pr` can forge
// to name another worktree's slug. The cache is consulted only as a fallback
// when no stack is registered for dir, and even then a cached slug that collides
// with a *different* registered worktree's slug is refused. Returns "" when no
// safe slug can be established (nothing is dropped).
func (o *Orchestrator) resolveDestroySlug(dir string) string {
	for _, st := range o.store.Stacks() {
		if canonicalPath(st.WorktreeDir) != dir {
			continue
		}
		if cached, ok := o.store.ReadSlugCache(dir); ok && cached != "" && cached != st.Slug {
			o.log.Warn("destroy: ignoring worktree slug cache that disagrees with the registry",
				zap.String("dir", dir), zap.String("cached", cached), zap.String("registry", st.Slug))
		}
		return st.Slug
	}
	cached, ok := o.store.ReadSlugCache(dir)
	if !ok || cached == "" {
		return ""
	}
	for _, st := range o.store.Stacks() {
		if st.Slug == cached && canonicalPath(st.WorktreeDir) != dir {
			o.log.Warn("destroy: refusing to drop databases — cached slug belongs to another registered worktree",
				zap.String("dir", dir), zap.String("cached", cached), zap.String("owner", st.WorktreeDir))
			return ""
		}
	}
	return cached
}

// dropWorktreeDatabases drops the ClickHouse + Postgres databases for slug — a
// worktree being destroyed has no readers left, so its data goes with it. The
// protected main database is always kept. Unlike pruneDatabases (which reads the
// worktree-local slug cache), the caller passes an authoritative slug derived
// from the registry, so a forged .langwatch-slug cannot redirect the drop at
// another worktree's database. (Kept separate from pruneDatabases, which lives
// in prune.go and is shared with the dry-run-capable Prune path.)
func (o *Orchestrator) dropWorktreeDatabases(ctx context.Context, slug string) {
	if slug == "" {
		return
	}
	db := domain.DatabaseForSlug(slug)
	if domain.IsProtectedDatabase(db) {
		return
	}
	if o.ch != nil && o.cfg.ShouldManageClickHouse {
		if dbs, err := o.ch.Databases(ctx); err == nil && slices.Contains(dbs, db) {
			if err := o.ch.DropDatabase(ctx, db); err != nil {
				o.log.Warn("destroy: clickhouse drop failed", zapErr(err))
			}
		}
	}
	if o.pg != nil && o.cfg.ShouldManagePostgres {
		if dbs, err := o.pg.Databases(ctx); err == nil && slices.Contains(dbs, db) {
			if err := o.pg.DropDatabase(ctx, db); err != nil {
				o.log.Warn("destroy: postgres drop failed", zapErr(err))
			}
		}
	}
}

// waitForProcessesDead blocks until every pid has exited or a bounded deadline
// passes, whichever comes first. A launcher that refuses to die within the
// window is left to the OS and the caller proceeds, rather than hanging the hub
// forever. Uses the wall clock deliberately: this is a real wait on OS
// processes, not domain time.
func (o *Orchestrator) waitForProcessesDead(pids []int) {
	if len(pids) == 0 {
		return
	}
	deadline := time.Now().Add(processDeathWait)
	for {
		if !o.anyAlive(pids) {
			return
		}
		if time.Now().After(deadline) {
			o.log.Warn("destroy: launcher still alive after bounded wait; proceeding", zap.Ints("pids", pids))
			return
		}
		time.Sleep(processDeathPoll)
	}
}

func (o *Orchestrator) anyAlive(pids []int) bool {
	for _, pid := range pids {
		if o.sys.ProcessAlive(pid) {
			return true
		}
	}
	return false
}

// canonicalPath normalises a path for identity comparison: it resolves symlinks
// and lexical noise (., .., trailing slashes) so /tmp/x and /private/tmp/x (or a
// case-variant on a case-insensitive filesystem) compare equal. When the path
// cannot be resolved (it does not exist yet, or a test uses a synthetic path) it
// falls back to a lexical clean so comparison still works.
func canonicalPath(p string) string {
	if p == "" {
		return p
	}
	if resolved, err := filepath.EvalSymlinks(p); err == nil {
		return resolved
	}
	return filepath.Clean(p)
}

// HubStack is one row of the hub TUI: a registered stack plus the live facts
// (health, footprint) the TUI shows and the directory its actions operate on.
type HubStack struct {
	Stack   domain.Stack
	IsLive  bool
	RSS     uint64
	PortsUp int
	// ServiceUp is the per-service port probe, keyed by service name.
	ServiceUp map[string]bool
}

// HubStacks assembles the hub rows from the registry + live probes.
func (o *Orchestrator) HubStacks() []HubStack {
	var rows []HubStack
	for _, st := range o.store.Stacks() {
		row := HubStack{Stack: st, IsLive: o.sys.ProcessAlive(st.LauncherPID), ServiceUp: map[string]bool{}}
		if row.IsLive {
			row.RSS = o.sys.GroupRSS(st.LauncherPID)
		}
		for _, svc := range st.Services {
			up := svc.Port != 0 && o.sys.PortInUse(svc.Port)
			row.ServiceUp[svc.Name] = up
			if up {
				row.PortsUp++
			}
		}
		rows = append(rows, row)
	}
	return rows
}

func (o *Orchestrator) stackBySlug(slug string) (domain.Stack, bool) {
	for _, st := range o.store.Stacks() {
		if st.Slug == slug {
			return st, true
		}
	}
	return domain.Stack{}, false
}

func isKnownWorktree(worktrees []Worktree, dir string) bool {
	dir = canonicalPath(dir)
	for _, wt := range worktrees {
		if canonicalPath(wt.Dir) == dir {
			return true
		}
	}
	return false
}
