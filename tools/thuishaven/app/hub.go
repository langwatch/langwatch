package app

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"time"

	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"

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

	o.stopAndDropForDir(ctx, dir)
	if err := o.hyg.RemoveWorktree(gitDir, dir); err != nil {
		return fmt.Errorf("removing worktree: %w", err)
	}
	o.hyg.PruneGitWorktrees(gitDir)
	return nil
}

// stopAndDropForDir stops every stack running from a (canonicalised) worktree
// dir, waits for the launchers to actually exit, and drops the worktree's
// ClickHouse + Postgres databases — the shared "make this worktree's data go
// away" sequence both DestroyWorktree (single) and DestroyWorktrees (batch) run
// before removing the directory. The database slug is resolved from the registry
// BEFORE downing (which deletes registry entries), so a forged .langwatch-slug
// cannot redirect the drop. It intentionally does not touch the git worktree
// admin — the callers decide whether to remove one worktree or rm many and prune
// once. Safe to run concurrently across distinct dirs: each downs only its own
// stacks and drops only its own databases.
func (o *Orchestrator) stopAndDropForDir(ctx context.Context, canonDir string) {
	dbSlug := o.resolveDestroySlug(canonDir)

	var downedPIDs []int
	for _, st := range o.store.Stacks() {
		if canonicalPath(st.WorktreeDir) != canonDir {
			continue
		}
		downedPIDs = append(downedPIDs, st.LauncherPID)
		if err := o.DownStack(ctx, st.Slug); err != nil {
			o.log.Warn("destroy: down failed (continuing)", zap.String("slug", st.Slug), zap.Error(err))
		}
	}
	// DownStack signals the launchers asynchronously (they die with their process
	// group); wait for them to actually exit before touching the databases or the
	// directory, so the removal does not race a node/vite stack still writing.
	o.waitForProcessesDead(downedPIDs)
	o.dropWorktreeDatabases(ctx, dbSlug)
}

// resolveDestroySlug picks the slug whose databases DestroyWorktree may drop,
// logging any slug-cache disagreement — the destroy path is where that
// tampering signal matters.
func (o *Orchestrator) resolveDestroySlug(dir string) string {
	slug, warns := o.slugForDir(dir)
	for _, w := range warns {
		o.log.Warn("destroy: "+w.message, w.fields...)
	}
	return slug
}

type slugWarning struct {
	message string
	fields  []zap.Field
}

// slugForDir picks the slug that owns dir's databases, silently. The registry
// is authoritative: a stack registered for dir carries the slug haven itself
// assigned, so it wins over the worktree-local slug cache (.langwatch-slug),
// which a hostile branch checked out via `haven pr` can forge to name another
// worktree's slug. The cache is consulted only as a fallback when no stack is
// registered for dir, and even then a cached slug that collides with a
// *different* registered worktree's slug is refused. Returns "" when no safe
// slug can be established (nothing is dropped). Read-only surfaces (the hub's
// worktree list, the prune plan) call this on every refresh, so it returns its
// warnings instead of logging them — only the destroy path speaks.
func (o *Orchestrator) slugForDir(dir string) (string, []slugWarning) {
	if slug, warns, ok := o.registrySlugForDir(dir); ok {
		return slug, warns
	}
	return o.cachedSlugForDir(dir)
}

// registrySlugForDir answers from the registry (ok=false when no stack is
// registered for dir), warning when the worktree-local cache disagrees.
func (o *Orchestrator) registrySlugForDir(dir string) (string, []slugWarning, bool) {
	for _, st := range o.store.Stacks() {
		if canonicalPath(st.WorktreeDir) != dir {
			continue
		}
		var warns []slugWarning
		if cached, ok := o.store.ReadSlugCache(dir); ok && cached != "" && cached != st.Slug {
			warns = append(warns, slugWarning{"ignoring worktree slug cache that disagrees with the registry",
				[]zap.Field{zap.String("dir", dir), zap.String("cached", cached), zap.String("registry", st.Slug)}})
		}
		return st.Slug, warns, true
	}
	return "", nil, false
}

// cachedSlugForDir is the fallback: the worktree-local cache, refused when the
// cached slug collides with a different registered worktree's slug.
func (o *Orchestrator) cachedSlugForDir(dir string) (string, []slugWarning) {
	cached, ok := o.store.ReadSlugCache(dir)
	if !ok || cached == "" {
		return "", nil
	}
	for _, st := range o.store.Stacks() {
		if st.Slug == cached && canonicalPath(st.WorktreeDir) != dir {
			return "", []slugWarning{{"refusing to drop databases — cached slug belongs to another registered worktree",
				[]zap.Field{zap.String("dir", dir), zap.String("cached", cached), zap.String("owner", st.WorktreeDir)}}}
		}
	}
	return cached, nil
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

// HubWorktree is a worktree with no registered stack — visible in the hub so
// "what is on this machine" includes the trees nothing is running from.
type HubWorktree struct {
	Dir, Branch, Slug    string
	IsPrimary, IsCurrent bool
}

// HubFootprint is the machine's memory picture as the hub header shows it:
// every dev-work process attributed once (domain.PartitionFootprint), plus the
// machine total and the daemon's pressure reading for context.
type HubFootprint struct {
	TotalRAM   uint64
	StacksRSS  uint64
	ServerRSS  map[string]uint64 // clickhouse | postgres | redis | containers
	AgentRSS   uint64
	AgentCount int
	ToolingRSS uint64
	// OtherRSS is everything alive that is not dev work — shown in its own
	// color so the chart reflects the whole machine.
	OtherRSS uint64
	Pressure domain.Pressure
}

// DevRSS is everything the partitioner attributed to dev work, summed.
func (f HubFootprint) DevRSS() uint64 {
	total := f.StacksRSS + f.AgentRSS + f.ToolingRSS
	for _, rss := range f.ServerRSS {
		total += rss
	}
	return total
}

// HubView is everything one hub refresh shows: the stacks, the stackless
// worktrees, the machine footprint, and the daemon's recent reap events
// (newest first).
type HubView struct {
	Stacks    []HubStack
	Worktrees []HubWorktree
	Footprint HubFootprint
	Events    []domain.ReapEvent
}

// HubView assembles one refresh of the hub from a single process listing plus
// the registry, the worktree list, and the daemon's records. gitDir is the
// repository the worktree list comes from and selfDir the worktree haven runs
// from (its row is marked protected); either may be "" to skip the listing.
func (o *Orchestrator) HubView(gitDir, selfDir string) HubView {
	stacks := o.store.Stacks()
	part := o.partitionMachine(stacks)
	view := HubView{Footprint: o.hubFootprint(part)}
	for i := range stacks {
		view.Stacks = append(view.Stacks, o.hubStackRow(&stacks[i], part))
	}
	view.Worktrees = o.hubWorktrees(gitDir, selfDir, stacks)
	view.Events = newestFirst(o.store.ReapEvents())
	return view
}

// partitionMachine attributes one process listing across the live stacks'
// launcher groups and everything else the footprint names.
func (o *Orchestrator) partitionMachine(stacks []domain.Stack) domain.Footprint {
	var launchers []int
	for i := range stacks {
		if o.sys.ProcessAlive(stacks[i].LauncherPID) {
			launchers = append(launchers, stacks[i].LauncherPID)
		}
	}
	samples := o.sys.ProcessSamples()
	fpSamples := make([]domain.FootprintSample, 0, len(samples))
	for _, s := range samples {
		fpSamples = append(fpSamples, domain.FootprintSample{PID: s.PID, PPID: s.PPID, PGID: s.PGID, RSS: s.RSSBytes, Command: s.Command})
	}
	return domain.PartitionFootprint(fpSamples, launchers)
}

// StackRSSByLauncher is each live stack's whole-tree resident set, keyed by
// launcher pid — the one number every reporting surface (hub, status, session,
// the daemon's pressure hint) should agree on. Group RSS is wrong for this:
// supervised children lead their own process groups, so a group sum sees only
// the launcher itself.
func (o *Orchestrator) StackRSSByLauncher() map[int]uint64 {
	part := o.partitionMachine(o.store.Stacks())
	out := make(map[int]uint64, len(part.StackRSS))
	for pid, rss := range part.StackRSS {
		out[pid] = uint64(max(rss, 0))
	}
	return out
}

func (o *Orchestrator) hubStackRow(st *domain.Stack, part domain.Footprint) HubStack {
	row := HubStack{Stack: *st, IsLive: o.sys.ProcessAlive(st.LauncherPID), ServiceUp: map[string]bool{}}
	if row.IsLive {
		row.RSS = uint64(max(part.StackRSS[st.LauncherPID], 0))
	}
	for _, svc := range st.Services {
		up := svc.Port != 0 && o.sys.PortInUse(svc.Port)
		row.ServiceUp[svc.Name] = up
		if up {
			row.PortsUp++
		}
	}
	return row
}

func (o *Orchestrator) hubFootprint(part domain.Footprint) HubFootprint {
	f := HubFootprint{
		TotalRAM:   o.sys.TotalMemory(),
		StacksRSS:  uint64(max(part.StacksRSS(), 0)),
		ServerRSS:  map[string]uint64{},
		AgentRSS:   uint64(max(part.AgentRSS, 0)),
		AgentCount: part.AgentCount,
		ToolingRSS: uint64(max(part.ToolingRSS, 0)),
		OtherRSS:   uint64(max(part.OtherRSS, 0)),
	}
	for name, rss := range part.ServerRSS {
		f.ServerRSS[name] = uint64(max(rss, 0))
	}
	rec, ok := o.store.ReadPressure()
	f.Pressure = domain.ReadPressure(rec, ok, o.sys.Now())
	return f
}

// hubWorktrees lists the repository's worktrees that have no registered stack,
// via the same scan (and the same primary/current protection flags) the prune
// picker uses. A repo that cannot be listed degrades to no rows, never an error
// — the hub must open even when git is momentarily unhappy.
func (o *Orchestrator) hubWorktrees(gitDir, selfDir string, stacks []domain.Stack) []HubWorktree {
	if gitDir == "" || o.hyg == nil {
		return nil
	}
	rows, err := o.PlanPrune(gitDir, selfDir)
	if err != nil {
		return nil
	}
	hasStack := map[string]bool{}
	for i := range stacks {
		hasStack[canonicalPath(stacks[i].WorktreeDir)] = true
	}
	var worktrees []HubWorktree
	for _, r := range rows {
		if hasStack[canonicalPath(r.Dir)] {
			continue
		}
		worktrees = append(worktrees, HubWorktree{
			Dir: r.Dir, Branch: r.Branch, Slug: r.Slug,
			IsPrimary: r.IsPrimary, IsCurrent: r.IsCurrent,
		})
	}
	return worktrees
}

// DashboardURL is the machine's cross-worktree web dashboard — what the hub's
// "w" opens.
func (o *Orchestrator) DashboardURL() string {
	scheme, port := o.proxy.Endpoint()
	return o.cfg.Naming.URL(domain.HubService, "", scheme, port)
}

// RedirectLogsToFile sends this orchestrator's logs to a file under the haven
// home instead of stderr — for commands that own the terminal with a
// full-screen TUI, where a stray log line scribbles over the interface. If the
// file cannot be opened the logs are dropped: a corrupted TUI is worse than a
// lost warning.
func (o *Orchestrator) RedirectLogsToFile(name string) {
	f, err := os.OpenFile(filepath.Join(o.cfg.Home, name), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		o.log = zap.NewNop()
		return
	}
	enc := zapcore.NewJSONEncoder(zap.NewProductionEncoderConfig())
	o.log = zap.New(zapcore.NewCore(enc, zapcore.AddSync(f), zap.InfoLevel))
}

func newestFirst(events []domain.ReapEvent) []domain.ReapEvent {
	out := make([]domain.ReapEvent, 0, len(events))
	for _, ev := range slices.Backward(events) {
		out = append(out, ev)
	}
	return out
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
