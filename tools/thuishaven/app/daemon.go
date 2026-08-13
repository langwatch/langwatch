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

// ensureDaemon guarantees a single machine-wide daemon is running, spawning one
// (detached) if not. Running `up` from any branch reuses the same daemon, so the
// dashboard, telemetry fan-out, and registry are shared — the multi-branch
// management the daemon exists for.
func (o *Orchestrator) ensureDaemon(worktreeDir string) {
	if o.daemonAlive() {
		return
	}
	logPath := filepath.Join(o.cfg.Home, "haven.log")
	if err := o.sys.SpawnDetached(o.cfg.DaemonArgv, worktreeDir, logPath); err != nil {
		o.log.Warn("could not spawn haven daemon", zap.Error(err))
		return
	}
	for i := 0; i < 50; i++ {
		if o.daemonAlive() {
			return
		}
		time.Sleep(100 * time.Millisecond)
	}
	o.log.Warn("haven daemon did not report ready in time (dashboard may be unavailable)")
}

func (o *Orchestrator) daemonAlive() bool {
	info, ok := o.store.Daemon()
	if !ok || !o.sys.ProcessAlive(info.PID) {
		return false
	}
	// PID liveness alone is unreliable: when the daemon dies its PID is recycled
	// by the OS to an unrelated process, which would leave `ensureDaemon`
	// believing a daemon is up while the dashboard route points at a closed port
	// (a 502). Confirm the daemon's own HTTP port is actually accepting
	// connections before trusting the record.
	return o.sys.PortInUse(info.Port)
}

// RunDaemon is the singleton server + monitor. It registers the shared surfaces
// (dashboard, telemetry, observability), serves them, and reaps stacks whose
// launcher has exited or gone stale.
func (o *Orchestrator) RunDaemon(ctx context.Context, dash Dashboard) error {
	if o.daemonAlive() {
		fmt.Println("haven daemon already running")
		return nil
	}
	if o.procTel != nil {
		// The final process-watch sample is flushed on the way out; without
		// this the periodic reader's last 30-second window dies with us.
		defer o.procTel.Close()
	}
	ports, err := o.sys.FreePorts(1)
	if err != nil {
		return err
	}
	port := ports[0]
	info := DaemonInfo{PID: o.sys.Getpid(), Port: port, URL: fmt.Sprintf("http://127.0.0.1:%d", port)}
	// Atomically claim the singleton slot BEFORE wiring routes — this both makes
	// `up` find us immediately and closes the startup race where two `up`s slip
	// past the daemonAlive() check above (which needs the port listening) and each
	// spawn a daemon. O_EXCL lets exactly one racer win. If we lose to a live owner
	// we defer to it; a record left by a crashed daemon (dead PID) is cleared and
	// the claim retried. ProcessAlive is the right liveness test here, not the
	// port: the winner has just written its own PID and may not be listening yet.
	for {
		claimed, err := o.store.ClaimDaemon(info)
		if err != nil {
			return err
		}
		if claimed {
			break
		}
		if owner, ok := o.store.Daemon(); ok && o.sys.ProcessAlive(owner.PID) {
			fmt.Println("haven daemon already running")
			return nil
		}
		o.store.ClearDaemon() // stale record from a crashed daemon — drop and retry
	}
	defer o.store.ClearDaemon()

	p := o.cfg.Naming.Project
	_ = o.proxy.Register(domain.HubService, "", port) // hub.langwatch.localhost (dashboard)
	_ = o.proxy.Register(p, "", port)                 // langwatch.localhost (legacy alias)
	_ = o.proxy.Register("telemetry", "", port)       // telemetry.langwatch.localhost (fan-out)
	o.refreshObservability(ctx)
	defer func() {
		o.proxy.Remove(domain.HubService, "")
		o.proxy.Remove(p, "")
		o.proxy.Remove("telemetry", "")
	}()

	scheme, pport := o.proxy.Endpoint()
	o.log.Info("haven daemon up",
		zap.Int("port", port),
		zap.String("dashboard", o.cfg.Naming.URL(domain.HubService, "", scheme, pport)))
	go o.monitorLoop(ctx)
	return dash.Serve(ctx, port)
}

// monitorLoop prunes stacks whose launcher has died (crashed pnpm dev, closed
// terminal) or whose heartbeat has gone stale past the idle TTL — pulling the
// whole stack down, routes and all.
func (o *Orchestrator) monitorLoop(ctx context.Context) {
	t := time.NewTicker(10 * time.Second)
	defer t.Stop()
	cycles := 0
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			cycles++
			// Every ~10 min, prune orphaned git worktree admin entries — the only
			// disk hygiene safe to do unattended (it never touches a live tree).
			// node_modules reclamation stays explicit (`haven prune --yes`).
			if o.hyg != nil && o.cfg.RepoRoot != "" && cycles%60 == 1 {
				o.hyg.PruneGitWorktrees(o.cfg.RepoRoot)
			}
			// Every ~10 min, refresh the idle clock of every registered stack's
			// databases, and prune databases whose worktree has not been up in
			// DBIdleTTL — the unattended counterpart of the interactive reclaim in
			// `haven clean` (`down` itself never discards data).
			if cycles%60 == 1 {
				o.reapTestContainers(ctx)
				// Fail closed: this clock guards destructive pruning, so if any
				// refresh cannot be persisted, skip pruning this cycle rather
				// than risk dropping a recently used database off a stale clock.
				touchesPersisted := true
				for _, s := range o.store.Stacks() {
					if err := o.store.TouchDBActivity(s.Slug); err != nil {
						touchesPersisted = false
						o.log.Warn("could not refresh database idle clock",
							zap.String("slug", s.Slug), zap.Error(err))
					}
				}
				if touchesPersisted {
					o.pruneIdleDatabases(ctx)
				}
			}
			now := o.sys.Now()
			for _, s := range o.store.Stacks() {
				dead := s.LauncherPID != 0 && !o.sys.ProcessAlive(s.LauncherPID)
				stale := s.Stale(now, o.cfg.IdleTTL)
				if !dead && !stale {
					continue
				}
				if stale && !dead {
					o.sys.Terminate(s.LauncherPID) // let the launcher stop its own children
				}
				for _, svc := range s.Services {
					o.proxy.Remove(svc.Name, s.Slug)
				}
				o.store.RemoveStack(s.Slug)
				o.log.Info("reaped stack", zap.String("slug", s.Slug), zap.Bool("dead", dead), zap.Bool("stale", stale))
			}
			o.governPressure()
			o.governProcesses()
			o.refreshObservability(ctx)
			o.reapClickHouse()
		}
	}
}

// vitestWorkerMarker is what an orphaned test worker's command line contains.
// Narrow on purpose: the sweep below reclaims a process only when it matches
// this AND is owned by PID 1, which together mean an interrupted run left it
// behind and nobody is coming back for it.
const vitestWorkerMarker = "vitest/dist/workers"

// governPressure is the daemon's whole response to a loaded machine (ADR-090).
//
// It samples, publishes, and then slows things down — it never kills. macOS can
// bound a process's memory (`taskpolicy -m` sets a jetsam limit at spawn), but
// jetsam kills what breaches it, which turns a slow machine into lost work.
// Demotion is reversible and costs nothing but time.
//
// The publish comes first and the work after it runs in the background, because
// everything after the sample shells out: a sweep, a process list, a taskpolicy
// call per stack, and two more probes per stack at red. Each is deadline-bound
// on its own, but on a degraded machine with several stacks running they add up
// on one tick — and a tick that outlasts domain.PressureStaleAfter makes every
// reader on the machine fall back to green, switching governance off exactly
// when the machine is at its worst. Publishing on a bounded path keeps the
// record fresh however long the slow half takes.
func (o *Orchestrator) governPressure() {
	level := domain.ClassifyPressure(o.sys.MemStat())
	o.publishPressure(level)

	if o.isGoverning.Swap(true) {
		// The previous tick's work is still going. Skipping is right rather than
		// sad: what it would do is decided from a reading now two ticks old, and
		// the run in flight is already doing it.
		return
	}
	o.governance.Add(1)
	go func() {
		defer o.governance.Done()
		defer o.isGoverning.Store(false)
		o.applyGovernance(level)
	}()
}

// awaitGovernance blocks until the slow half of the current tick has finished.
// For tests, which assert on what it did.
func (o *Orchestrator) awaitGovernance() { o.governance.Wait() }

// applyGovernance is the slow half: everything that shells out.
func (o *Orchestrator) applyGovernance(level domain.Pressure) {
	o.sweepOrphanedWorkers()

	stacks := o.store.Stacks()
	if len(stacks) == 0 {
		return
	}
	if level == domain.Green {
		o.restoreDemoted(stacks)
		return
	}
	o.demoteUnfocused(stacks)
	if level == domain.Red {
		o.warnCritical()
	}
}

// publishPressure runs before any demotion, so readers see the current level
// even if the demotion does nothing. A failure to publish is not worth a tick:
// readers treat a missing record as green, which disables narrowing and refusal
// and leaves slot counting exactly as it was.
func (o *Orchestrator) publishPressure(level domain.Pressure) {
	if err := o.store.WritePressure(domain.PressureRecord{
		Version:   domain.PressureRecordVersion,
		Level:     level.String(),
		WrittenAt: o.sys.Now(),
	}); err != nil {
		o.log.Warn("could not publish memory pressure", zap.Error(err))
	}
}

// governable reports whether a stack's launcher is a pid worth signaling.
//
// The zero check is not defensive tidiness: a registered stack can carry
// LauncherPID == 0 (the reaper above guards it for the same reason), and pid 0
// in kill(2) addresses the caller's OWN process group. Demoting it would demote
// the daemon, and every group operation here would then be aimed at haven
// itself.
func (o *Orchestrator) governable(s domain.Stack) bool {
	return s.LauncherPID != 0 && o.sys.ProcessAlive(s.LauncherPID)
}

func (o *Orchestrator) restoreDemoted(stacks []domain.Stack) {
	for _, s := range stacks {
		if o.governable(s) {
			o.sys.RestoreGroup(s.LauncherPID)
		}
	}
}

// demoteUnfocused slows every live stack except the head of Stacks(), which is
// ordered most-recently-updated first — the head is the worktree being worked
// in, and demoting that one would slow down exactly the thing the developer is
// watching.
func (o *Orchestrator) demoteUnfocused(stacks []domain.Stack) {
	focused := stacks[0].Slug
	for _, s := range stacks {
		if s.Slug == focused || !o.governable(s) {
			continue
		}
		o.sys.DemoteGroup(s.LauncherPID)
	}
}

// warnCritical names the largest stack, and does no more than name it. The
// daemon did not start this work and has no standing to end it; the operator
// decides.
func (o *Orchestrator) warnCritical() {
	slug, rss := o.fattestStack()
	if slug == "" {
		return
	}
	o.log.Warn("memory pressure critical",
		zap.String("largest_stack", slug),
		zap.String("rss", domain.HumanBytes(int64(rss))),
		zap.String("hint", "haven down "+slug))
}

// sweepOrphanedWorkers reclaims test workers an interrupted run left parented to
// PID 1. haven already does this for dev-runtime processes at every `up`
// (procsupervisor.reapOrphans); this is the same rule on the tick, widened to
// the workers CLAUDE.md currently asks people to pkill by hand.
func (o *Orchestrator) sweepOrphanedWorkers() {
	orphans := o.sys.OrphanedWorkers(vitestWorkerMarker)
	for _, pid := range orphans {
		if pid <= 0 {
			continue // pid 0 kills the daemon's own process group
		}
		o.sys.KillGroup(pid)
	}
	if len(orphans) > 0 {
		o.log.Info("reclaimed orphaned test workers", zap.Int("count", len(orphans)))
	}
}

// fattestStack names the live stack with the largest process-group footprint.
// Approximate by construction — GroupRSS double-counts shared pages — which is
// fine for "which one should I look at first" and is why it is never a control
// input.
func (o *Orchestrator) fattestStack() (slug string, rss uint64) {
	for _, s := range o.store.Stacks() {
		if !o.sys.ProcessAlive(s.LauncherPID) {
			continue
		}
		if got := o.sys.GroupRSS(s.LauncherPID); got > rss {
			slug, rss = s.Slug, got
		}
	}
	return slug, rss
}

// pruneIdleDatabases drops per-slug ClickHouse + Postgres databases whose
// worktree has not been up for DBIdleTTL (0 disables). It only ever considers
// databases haven itself put on the idle clock (touched by every `up`), never
// one owned by a currently-registered stack, and never the protected main
// database. A record whose database no longer exists on either server is
// dropped from the clock so it does not accumulate.
func (o *Orchestrator) pruneIdleDatabases(ctx context.Context) {
	ttl := o.cfg.DBIdleTTL
	if ttl <= 0 {
		return
	}
	activity := o.store.DBActivity()
	if len(activity) == 0 {
		return
	}
	registered := map[string]bool{}
	for _, st := range o.store.Stacks() {
		registered[st.Slug] = true
	}
	var chDBs, pgDBs []string
	if o.ch != nil && o.cfg.ShouldManageClickHouse {
		if dbs, err := o.ch.Databases(ctx); err == nil {
			chDBs = dbs
		} else {
			return // server unreachable — can't tell what exists, touch nothing
		}
	}
	if o.pg != nil && o.cfg.ShouldManagePostgres {
		if dbs, err := o.pg.Databases(ctx); err == nil {
			pgDBs = dbs
		} else {
			return
		}
	}
	now := o.sys.Now()
	for slug, lastSeen := range activity {
		if registered[slug] || now.Sub(lastSeen) <= ttl || !domain.ValidSlug(slug) {
			continue
		}
		db := domain.DatabaseForSlug(slug)
		if domain.IsProtectedDatabase(db) {
			continue
		}
		existsSomewhere := false
		if o.ch != nil && o.cfg.ShouldManageClickHouse && slices.Contains(chDBs, db) {
			existsSomewhere = true
			if err := o.ch.DropDatabase(ctx, db); err != nil {
				o.log.Warn("idle-db prune: clickhouse drop failed", zap.String("db", db), zap.Error(err))
				continue
			}
		}
		if o.pg != nil && o.cfg.ShouldManagePostgres && slices.Contains(pgDBs, db) {
			existsSomewhere = true
			if err := o.pg.DropDatabase(ctx, db); err != nil {
				o.log.Warn("idle-db prune: postgres drop failed", zap.String("db", db), zap.Error(err))
				continue
			}
		}
		o.store.RemoveDBActivity(slug)
		if existsSomewhere {
			o.log.Info("pruned idle databases", zap.String("slug", slug), zap.String("db", db), zap.Duration("idle", now.Sub(lastSeen)))
		}
	}
}

// reapTestContainers removes containers a testcontainers run left behind —
// the library's own reaper (Ryuk) dies with the run that started it, so an
// interrupted integration test leaves its ClickHouse/Redis running in the
// shared VM until something else sweeps them. Stopped containers get the short
// TTL; running ones a much longer one, because a running container may still
// be serving a live run whatever its birthday says (withReuse keeps the
// original CreatedAt across runs). The running TTL never undercuts the stopped
// one, so a single misconfigured knob cannot make live containers the more
// eagerly reaped kind.
func (o *Orchestrator) reapTestContainers(ctx context.Context) {
	ttl := o.cfg.TestContainerTTL
	if o.janitor == nil || ttl <= 0 {
		return
	}
	runningTTL := max(o.cfg.RunningTestContainerTTL, ttl)
	now := o.sys.Now()
	names, err := o.janitor.ReapTestContainers(ctx, now.Add(-ttl), now.Add(-runningTTL))
	if err != nil {
		o.log.Warn("test-container sweep failed", zap.Error(err))
		return
	}
	if len(names) > 0 {
		o.log.Info("reaped leaked test containers", zap.Strings("containers", names))
	}
}

// reapClickHouse stops the shared managed clickhouse-server once no stacks remain,
// reclaiming its memory (opt-in via StopClickHouseIdle). Data + endpoint stay on
// disk, so the next `haven up` restarts it with every per-slug database intact.
func (o *Orchestrator) reapClickHouse() {
	if o.ch == nil || !o.cfg.ShouldStopClickHouseIdle {
		return
	}
	if len(o.store.Stacks()) == 0 && o.ch.Running() {
		o.ch.Stop()
		o.log.Info("stopped idle managed clickhouse-server (no stacks running)")
	}
}

// refreshObservability keeps observability.langwatch.localhost pointed at the
// LGTM stack for as long as it is answering. The daemon re-checks on every cycle
// rather than once at boot, because the stack can be brought up and torn down
// (`haven observability up|down`) long after the daemon started.
func (o *Orchestrator) refreshObservability(ctx context.Context) {
	if o.obs == nil {
		return
	}
	if o.obs.IsRunning(ctx) {
		o.routeObservability()
		return
	}
	o.proxy.Remove(domain.ObservabilityService, "")
}
