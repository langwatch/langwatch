package app

import (
	"context"
	"errors"
	"fmt"
	"os"
	"slices"
	"strings"
	"time"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// Orchestrator wires the domain to the ports. It is the entry point for every
// haven subcommand.
type Orchestrator struct {
	cfg   Config
	proxy Proxy
	store Store
	sup   Supervisor
	sys   System
	ch    ClickHouse
	pg    Postgres
	rds   Redis
	obs   Observability
	hyg   Hygiene
	sem   Semaphore
	log   *zap.Logger
}

// New builds an Orchestrator from its injected dependencies.
func New(cfg Config, proxy Proxy, store Store, sup Supervisor, sys System, ch ClickHouse, pg Postgres, rds Redis, obs Observability, hyg Hygiene, sem Semaphore, log *zap.Logger) *Orchestrator {
	return &Orchestrator{cfg: cfg, proxy: proxy, store: store, sup: sup, sys: sys, ch: ch, pg: pg, rds: rds, obs: obs, hyg: hyg, sem: sem, log: log}
}

// UpParams identify the worktree `up` runs in (resolved by the composition root).
type UpParams struct {
	WorktreeDir      string
	LwDir            string
	Branch           string
	ExplicitSlug     string // from LANGWATCH_SLUG; wins over the derived/cached slug
	IsBaseline       bool   // this stack is the shared default others fall back to
	IsLinkedWorktree bool   // a `git worktree add` checkout, not the primary clone
}

// resolveSlug applies the precedence: explicit > cache > derived (then cached).
func (o *Orchestrator) resolveSlug(p UpParams) (string, error) {
	if p.ExplicitSlug != "" {
		if !domain.ValidSlug(p.ExplicitSlug) {
			return "", domain.ErrInvalidSlug(p.ExplicitSlug)
		}
		return p.ExplicitSlug, nil
	}
	// The primary checkout's directory is the repo name itself ("langwatch"),
	// which would collide with the project label to produce the doubled
	// app.langwatch.langwatch.localhost. Key its slug on the branch instead — and
	// deliberately skip the path cache, since the branch (and so the slug) changes
	// under the same directory. Linked worktrees keep their stable per-directory
	// slug.
	if !p.IsLinkedWorktree {
		// Use the branch slug unless another worktree already owns it (a linked
		// worktree whose directory name derives the same slug). Reusing it there
		// would clobber their registry entry, so fall through to DeriveSlug, which
		// disambiguates. Our own prior stack (same worktree dir) is not a conflict —
		// re-running `up` on the same branch must keep the same slug.
		if s := domain.SlugFromBranch(p.Branch); s != "" && !o.slugOwnedByOther(s, p.WorktreeDir) {
			return s, nil
		}
	}
	if s, ok := o.store.ReadSlugCache(p.WorktreeDir); ok && domain.ValidSlug(s) {
		return s, nil
	}
	s := domain.DeriveSlug(p.WorktreeDir, o.store.TakenSlugs())
	_ = o.store.WriteSlugCache(p.WorktreeDir, s)
	return s, nil
}

// provision resolves the slug, allocates ports, registers the hostnames, writes
// the overlay + registry entry, and starts the heartbeat. It returns the stack
// and a cleanup that deregisters the routes and drops the registry entry. When
// shouldManageDBs is set it also ensures the shared ClickHouse + Postgres servers
// and this stack's databases on them before the overlay is written, so
// CLICKHOUSE_URL/DATABASE_URL are in the overlay from the printed stack's first line.
func (o *Orchestrator) provision(ctx context.Context, p UpParams, opts PlanOptions, shouldManageDBs bool) (domain.Stack, func(), error) {
	slug, err := o.resolveSlug(p)
	if err != nil {
		return domain.Stack{}, nil, err
	}
	nSvc := len(domain.PerWorktreeServices)
	ports, err := o.sys.FreePorts(nSvc + 2)
	if err != nil {
		return domain.Stack{}, nil, err
	}
	scheme, pport := o.proxy.Endpoint()
	// ports[0..nSvc-1] back the routed services (app/gateway/nlp/langyagent, in
	// PerWorktreeServices order); ports[nSvc] is the API backend behind app's /api,
	// ports[nSvc+1] the worker metrics endpoint.
	st := domain.Stack{
		Slug: slug, WorktreeDir: p.WorktreeDir, Branch: p.Branch,
		LauncherPID: o.sys.Getpid(), RedisDB: domain.RedisDBForSlug(slug),
		APIPort: ports[nSvc], WorkerMetricsPort: ports[nSvc+1], LocalAPIKey: o.cfg.LocalAPIKey, IsBaseline: p.IsBaseline,
		// Mirror planChildren: a separate `workers` lane exists only when workers
		// are requested AND not hosted in-process. Persist it so restart targets
		// the workers' own group rather than the API's when they share a process.
		HasStandaloneWorkers: opts.ShouldStartWorkers && !opts.ShouldRunWorkersInProcess,
	}
	for i, r := range domain.PerWorktreeServices {
		svc := domain.Service{
			Name: r.Name, Role: r.Role, Port: ports[i],
			Hostname: o.cfg.Naming.Hostname(r.Name, slug),
			URL:      o.cfg.Naming.URL(r.Name, slug, scheme, pport),
		}
		// A service this worktree opts out of (gateway/nlp/langyagent) resolves to a
		// live baseline stack's copy when one exists, so its URL stays defined. With
		// no baseline to fall back to it is genuinely unavailable: drop the
		// preallocated port so it is neither routed (dead 502) nor emitted into the
		// overlay (e.g. an OPENCODE_AGENT_URL/LANGY_INTERNAL_SECRET for a dead
		// socket). The app is always local.
		if !runsLocally(r.Name, opts) {
			if bp, ok := o.baselinePort(r.Name); ok {
				svc.Port, svc.IsFallback = bp, true
			} else {
				svc.Port = 0
			}
		}
		st.Services = append(st.Services, svc)
		if svc.Port != 0 {
			if err := o.proxy.Register(svc.Name, slug, svc.Port); err != nil {
				o.log.Warn("alias registration failed", zap.String("host", svc.Hostname), zap.Error(err))
			}
		}
	}
	if shouldManageDBs {
		o.ensureClickHouse(ctx, &st)
		o.ensurePostgres(ctx, &st)
		o.ensureRedis(ctx, &st)
	}
	o.linkObservability(ctx, &st)
	st.UpdatedAt = o.sys.Now()
	if err := o.store.WriteOverlay(p.LwDir, st); err != nil {
		return domain.Stack{}, nil, err
	}
	if err := o.store.SaveStack(st); err != nil {
		return domain.Stack{}, nil, err
	}
	cleanup := func() {
		for _, s := range st.Services {
			o.proxy.Remove(s.Name, slug)
		}
		o.store.RemoveStack(slug)
	}
	// Start (or refresh) the databases' idle clock: the daemon prunes databases
	// whose slug has not been up for DBIdleTTL, and this is what "up" means.
	// A silently stale clock could get this stack's databases pruned as idle
	// once it unregisters, so a failed write fails the up.
	if err := o.store.TouchDBActivity(st.Slug); err != nil {
		cleanup()
		return domain.Stack{}, nil, fmt.Errorf("recording database activity for %q: %w", st.Slug, err)
	}
	o.printStack(st)
	go o.heartbeat(ctx, st)
	return st, cleanup, nil
}

// heartbeat keeps the stack's UpdatedAt fresh so the daemon's reaper can tell a
// live-but-quiet stack from a launcher that has gone away.
func (o *Orchestrator) heartbeat(ctx context.Context, st domain.Stack) {
	every := o.cfg.HeartbeatEvery
	if every <= 0 {
		every = 30 * time.Second
	}
	t := time.NewTicker(every)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			st.UpdatedAt = o.sys.Now()
			_ = o.store.SaveStack(st)
		}
	}
}

// Setup is the one-time machine bootstrap `haven setup` runs: it verifies
// portless is installed (pointing the user at how to install it if not), then
// starts the proxy and trusts its CA. Idempotent — safe to re-run.
func (o *Orchestrator) Setup(ctx context.Context) error {
	if !o.proxy.Installed() {
		fmt.Println("portless is not installed — haven routes worktree hostnames through it.")
		fmt.Println()
		fmt.Println("Install it, then re-run `haven setup`:")
		fmt.Println("  npm install -g portless                 # recommended")
		fmt.Println("  brew install portless                   # if you have a portless tap")
		return fmt.Errorf("portless not found — install it and re-run `haven setup`")
	}
	if err := o.proxy.EnsureReady(); err != nil {
		return fmt.Errorf("portless proxy setup failed: %w", err)
	}
	scheme, port := o.proxy.Endpoint()
	fmt.Println("thuishaven ready.")
	fmt.Printf("  proxy:     %s://…langwatch.localhost (port %d)\n", scheme, port)
	fmt.Println("  next:      `haven up` in any worktree")
	fmt.Println("  dashboard: https://langwatch.localhost")
	return nil
}

// Up is the launcher hook `pnpm dev:haven` runs in portless mode.
func (o *Orchestrator) Up(ctx context.Context, p UpParams, opts PlanOptions) error {
	if err := o.proxy.EnsureReady(); err != nil {
		return fmt.Errorf("could not start the portless proxy automatically (%w) — run `haven setup` once to bootstrap it by hand", err)
	}
	slug, err := o.resolveSlug(p)
	if err != nil {
		return err
	}
	// Serialize `up` per slug: two concurrent runs could both pass the
	// already-running guard and then both register the same slug. The lock is
	// held only through guard + registration — holding it across supervision
	// would make `up --force` wait forever on the launcher it is meant to
	// replace (flocks die with their process, so a killed launcher can't leak
	// the slot).
	release, _, err := o.sem.Acquire(ctx, "up-"+slug, 1)
	if err != nil {
		return err
	}
	registering := true
	endRegistration := func() {
		if registering {
			registering = false
			release()
		}
	}
	defer endRegistration()
	if err := o.replaceRunningStack(p, opts.ShouldForce); err != nil {
		return err
	}
	o.ensureDaemon(p.WorktreeDir)
	st, cleanup, err := o.provision(ctx, p, opts, true)
	if err != nil {
		return err
	}
	defer cleanup()
	endRegistration()

	env := st.OverlayEnv()
	// Codegen (prisma/zod/sdk-versions/mcp) then migrations — both finish before
	// the services boot. Owned here so `pnpm dev` is simply `haven up`.
	if err := o.sup.RunOnce(ctx, "codegen", p.LwDir, "pnpm run start:prepare:files", env); err != nil {
		o.log.Warn("codegen (start:prepare:files) failed (continuing)", zap.Error(err))
	}
	if err := o.sup.RunOnce(ctx, "prepare", p.LwDir, "pnpm run start:prepare:db", env); err != nil {
		o.log.Warn("db prepare failed (continuing)", zap.Error(err))
	}
	// Always seed. The seed is idempotent (a no-op once the stable local project +
	// API key exist), so every `up` guarantees the same migrations AND the same
	// seeded credential are in place — a freshly-provisioned DB is immediately
	// usable with the well-known LANGWATCH_API_KEY, no manual sign-up.
	//
	// When haven manages Postgres the overlay carries a per-slug loopback
	// DATABASE_URL (provably local) and the seed uses it. When it does not — DB
	// management disabled, or Postgres failed to come up — the seed would inherit
	// whatever DATABASE_URL is in .env, so guard that inherited URL exactly as
	// `haven seed` does and skip (never seed a non-local database) rather than
	// abort the up.
	if hasEnvKey(env, "DATABASE_URL") {
		if err := o.sup.RunOnce(ctx, "seed", p.LwDir, "pnpm run prisma:seed", env); err != nil {
			o.log.Warn("seed failed (continuing)", zap.Error(err))
		}
	} else if err := o.guardInheritedSeedEnv(p.LwDir); err != nil {
		o.log.Warn("skipping seed — inherited database URL is not local", zap.Error(err))
		fmt.Printf("haven: %v — skipping seed\n", err)
	} else if err := o.sup.RunOnce(ctx, "seed", p.LwDir, "pnpm run prisma:seed", env); err != nil {
		o.log.Warn("seed failed (continuing)", zap.Error(err))
	}
	o.sup.Supervise(ctx, o.planChildren(st, opts, p.LwDir))
	return nil
}

// UpStub is the verification path: it provisions the stack exactly like Up, then
// stands echo servers up on the service ports (via the injected echo starter)
// instead of the real apps, so the whole resolve -> alias -> registry ->
// dashboard -> routing chain is exercised without Postgres/ClickHouse/Redis.
func (o *Orchestrator) UpStub(ctx context.Context, p UpParams, echo func(ports []int)) error {
	o.ensureDaemon(p.WorktreeDir)
	st, cleanup, err := o.provision(ctx, p, PlanOptions{}, false)
	if err != nil {
		return err
	}
	defer cleanup()
	var ports []int
	for _, s := range st.Services {
		ports = append(ports, s.Port)
	}
	echo(ports)
	<-ctx.Done()
	return nil
}

// replaceRunningStack is `up`'s already-running guard: when a live launcher
// already runs this worktree's stack it refuses (the second `up` would fight the
// first over routes and the registry entry) unless shouldForce is set, in which
// case the old launcher is terminated — and waited on — so the new `up` takes
// over cleanly.
func (o *Orchestrator) replaceRunningStack(p UpParams, shouldForce bool) error {
	slug, err := o.resolveSlug(p)
	if err != nil {
		return err
	}
	st, ok := o.stackBySlug(slug)
	if !ok || st.LauncherPID == o.sys.Getpid() || !o.sys.ProcessAlive(st.LauncherPID) {
		return nil
	}
	if !shouldForce {
		return fmt.Errorf("stack %q is already running (launcher pid %d) — `haven restart [service]` to bounce a service, `haven down` to stop it, or `haven up --force` to replace it", slug, st.LauncherPID)
	}
	fmt.Printf("haven: stack %q is already running (pid %d) — replacing it (--force)\n", slug, st.LauncherPID)
	o.sys.Terminate(st.LauncherPID)
	o.waitForProcessesDead([]int{st.LauncherPID})
	return nil
}

// Down tears the current worktree's stack down from anywhere: it stops a live
// launcher (the supervised children die with their process group), removes the
// routes, and drops the registry entry. Databases are KEPT by default — tearing
// a stack down must not silently discard data; pass shouldDropDB (--drop-db) for
// the "give me a fresh DB" affordance, so the next `up` re-runs migrations into
// a clean, correctly-counted schema. Long-unused databases are pruned in the
// background by the daemon (DBIdleTTL) or explicitly via `haven prune`.
func (o *Orchestrator) Down(ctx context.Context, p UpParams, shouldDropDB bool) error {
	slug, err := o.resolveSlug(p)
	if err != nil {
		return err
	}
	if st, ok := o.stackBySlug(slug); ok && st.LauncherPID != o.sys.Getpid() && o.sys.ProcessAlive(st.LauncherPID) {
		o.sys.Terminate(st.LauncherPID)
		o.waitForProcessesDead([]int{st.LauncherPID})
		fmt.Printf("stopped launcher (pid %d)\n", st.LauncherPID)
	}
	for _, r := range domain.PerWorktreeServices {
		o.proxy.Remove(r.Name, slug)
	}
	o.proxy.Remove(domain.ClickHouseService, slug)
	o.proxy.Remove(domain.PostgresService, slug)
	// Attempt every drop even if one fails, so route/registry cleanup always
	// completes, but AGGREGATE the failures and return them. A dropped-DB request
	// that silently retained the old database would let `haven down --drop-db &&
	// haven up` reuse stale state while reporting a clean reset.
	var dropErrs []error
	if o.ch != nil && o.cfg.ShouldManageClickHouse && shouldDropDB {
		db := domain.DatabaseForSlug(slug)
		if err := o.ch.DropDatabase(ctx, db); err != nil {
			o.log.Warn("could not drop clickhouse database", zap.String("db", db), zap.Error(err))
			dropErrs = append(dropErrs, fmt.Errorf("dropping clickhouse database %q: %w", db, err))
		} else {
			fmt.Printf("dropped clickhouse database %q\n", db)
		}
	}
	if o.pg != nil && o.cfg.ShouldManagePostgres && shouldDropDB {
		db := domain.DatabaseForSlug(slug)
		if err := o.pg.DropDatabase(ctx, db); err != nil {
			o.log.Warn("could not drop postgres database", zap.String("db", db), zap.Error(err))
			dropErrs = append(dropErrs, fmt.Errorf("dropping postgres database %q: %w", db, err))
		} else {
			fmt.Printf("dropped postgres database %q\n", db)
		}
	}
	o.store.RemoveStack(slug)
	if len(dropErrs) > 0 {
		return fmt.Errorf("stack %q stopped but database drop failed — state may be stale: %w", slug, errors.Join(dropErrs...))
	}
	fmt.Printf("stack %q torn down\n", slug)
	return nil
}

// ensureClickHouse starts the shared managed clickhouse-server (if not already
// up), creates this stack's isolated database, registers the always-resolving
// clickhouse.<slug> route, and records the endpoint on the stack so OverlayEnv
// emits CLICKHOUSE_URL. Failures are non-fatal: haven warns and leaves the app to
// fall back to whatever CLICKHOUSE_URL is pinned in .env.
func (o *Orchestrator) ensureClickHouse(ctx context.Context, st *domain.Stack) {
	if o.ch == nil || !o.cfg.ShouldManageClickHouse {
		return
	}
	port, err := o.ch.Ensure(ctx)
	if err != nil {
		o.log.Warn("clickhouse unavailable — falling back to .env CLICKHOUSE_URL", zap.Error(err))
		return
	}
	db := domain.DatabaseForSlug(st.Slug)
	if err := o.ch.EnsureDatabase(ctx, db); err != nil {
		o.log.Warn("could not create clickhouse database", zap.String("db", db), zap.Error(err))
		return
	}
	st.ClickHouseHTTPPort = port
	st.ClickHouseDatabase = db
	scheme, pport := o.proxy.Endpoint()
	st.Services = append(st.Services, domain.Service{
		Name: domain.ClickHouseService, Role: "ClickHouse (this stack's DB)", Port: port,
		Hostname: o.cfg.Naming.Hostname(domain.ClickHouseService, st.Slug),
		URL:      o.cfg.Naming.URL(domain.ClickHouseService, st.Slug, scheme, pport),
	})
	if err := o.proxy.Register(domain.ClickHouseService, st.Slug, port); err != nil {
		o.log.Warn("clickhouse alias registration failed", zap.Error(err))
	}
}

// ensurePostgres starts (or reuses) the shared brew-managed Postgres, creates
// this stack's isolated database, registers the always-resolving postgres.<slug>
// route, and records the endpoint on the stack so OverlayEnv emits DATABASE_URL.
// Failures are non-fatal: haven warns and leaves the app to fall back to
// whatever DATABASE_URL is pinned in .env.
func (o *Orchestrator) ensurePostgres(ctx context.Context, st *domain.Stack) {
	if o.pg == nil || !o.cfg.ShouldManagePostgres {
		return
	}
	port, err := o.pg.Ensure(ctx)
	if err != nil {
		o.log.Warn("postgres unavailable — falling back to .env DATABASE_URL", zap.Error(err))
		return
	}
	db := domain.DatabaseForSlug(st.Slug)
	if err := o.pg.EnsureDatabase(ctx, db); err != nil {
		o.log.Warn("could not create postgres database", zap.String("db", db), zap.Error(err))
		return
	}
	st.PostgresPort = port
	st.PostgresDatabase = db
	// No portless route: unlike ClickHouse (HTTP), Postgres speaks its own wire
	// protocol, so an https://postgres.<slug>... URL through the HTTP proxy would
	// just 502 — confirmed live (curl returns 502, portless can't speak Postgres
	// wire protocol). But the hostname still resolves to loopback natively, so we
	// list it as a real connection target on the shared port (the app connects the
	// same way via DATABASE_URL; `haven postgres url` prints it).
	st.Services = append(st.Services, domain.Service{
		Name: domain.PostgresService, Role: "Postgres (this stack's DB)", Port: port,
		Hostname: o.cfg.Naming.Hostname(domain.PostgresService, st.Slug),
		URL:      fmt.Sprintf("%s:%d", o.cfg.Naming.Hostname(domain.PostgresService, st.Slug), port),
	})
}

// ensureRedis starts (or reuses) the shared brew-managed Redis and records its
// port on the stack so OverlayEnv emits REDIS_URL. No per-slug database is
// needed — RedisDB (set in provision) already partitions worktrees by DB index
// on the one server. Failures are non-fatal: haven warns and leaves the app to
// fall back to whatever REDIS_URL is pinned in .env.
func (o *Orchestrator) ensureRedis(ctx context.Context, st *domain.Stack) {
	if o.rds == nil || !o.cfg.ShouldManageRedis {
		return
	}
	port, err := o.rds.Ensure(ctx)
	if err != nil {
		o.log.Warn("redis unavailable — falling back to .env REDIS_URL", zap.Error(err))
		return
	}
	st.RedisPort = port
	// Like Postgres, Redis speaks a raw TCP protocol portless can't proxy, but the
	// hostname resolves to loopback, so list it as a real connection target on the
	// shared port. Worktrees are partitioned by RedisDB index, not by server.
	st.Services = append(st.Services, domain.Service{
		Name: domain.RedisService, Role: fmt.Sprintf("Redis (this stack's DB %d)", st.RedisDB), Port: port,
		Hostname: o.cfg.Naming.Hostname(domain.RedisService, st.Slug),
		URL:      fmt.Sprintf("%s:%d", o.cfg.Naming.Hostname(domain.RedisService, st.Slug), port),
	})
}

// SeedPresets are the seed variants beyond the plain static identity. "demo"
// seeds the project as already past onboarding and ingests sample traces
// through the running stack's collector, so the UI opens on real-looking data.
var SeedPresets = []string{"demo"}

// SeedOptions tune what `haven seed` layers on top of the stable identity.
// Every extra is individually controllable: the flags map to HAVEN_SEED_*
// env vars the seed script reads, so env-driven setups work identically.
type SeedOptions struct {
	Preset string
	// ShouldIngestTraces ingests the deterministic sample traces through the
	// running stack's collector after the seed (--traces / HAVEN_SEED_TRACES=1;
	// always on for the demo preset).
	ShouldIngestTraces bool
	// ExtraEnv is appended to the seed child's environment — the HAVEN_SEED_*
	// switches resolved from CLI flags (--first-message, --skip-model-providers).
	ExtraEnv []string
}

// Seed reseeds the current stack's database — the "give me a fresh DB"
// affordance. A preset layers a variant on top of the stable identity; the
// empty preset is the unchanged default.
func (o *Orchestrator) Seed(ctx context.Context, p UpParams, opts SeedOptions) error {
	preset := opts.Preset
	if preset != "" && !slices.Contains(SeedPresets, preset) {
		return fmt.Errorf("unknown seed preset %q — available: %s", preset, strings.Join(SeedPresets, ", "))
	}
	// Seed the database this worktree's stack actually uses — not whatever
	// DATABASE_URL happens to be inherited. seedEnv resolves the running stack and
	// passes its overlay (per-slug loopback DATABASE_URL/CLICKHOUSE_URL, the local
	// API key) into the child, mirroring the `up` path, so the env cmd.guardSeedEnv
	// validated and the env the seed connects to are the same provably-local target.
	env := o.seedEnv(p)
	if preset != "" {
		env = append(env, "HAVEN_SEED_PRESET="+preset)
	}
	env = append(env, opts.ExtraEnv...)
	if err := o.sup.RunOnce(ctx, "seed", p.LwDir, "pnpm run prisma:seed", env); err != nil {
		return err
	}
	if preset != "demo" && !opts.ShouldIngestTraces {
		return nil
	}
	// The retry hint must repeat what the user actually ran: `--preset demo`
	// would also flip the onboarding state for a plain `--traces` run.
	retryCmd := "haven seed --traces"
	if preset == "demo" {
		retryCmd = "haven seed --preset demo"
	}
	return o.seedSampleTraces(ctx, p, retryCmd)
}

// seedEnv builds the base environment for the prisma:seed child: the running
// stack's resolved overlay when one is registered (so the seed writes into this
// worktree's per-slug database rather than whatever DATABASE_URL is inherited),
// always carrying HAVEN_SEED_LANGWATCH_API_KEY so the seeded project key matches
// the local ingestion key — otherwise a re-seed rotates it back to the default
// and the subsequent sample-trace ingestion 401s. With no stack registered the
// child inherits the (guardSeedEnv-validated) process/.env environment.
func (o *Orchestrator) seedEnv(p UpParams) []string {
	var env []string
	if slug, err := o.resolveSlug(p); err == nil {
		if st, ok := o.stackBySlug(slug); ok {
			env = st.OverlayEnv()
		}
	}
	if o.cfg.LocalAPIKey != "" && !hasEnvKey(env, "HAVEN_SEED_LANGWATCH_API_KEY") {
		env = append(env, "HAVEN_SEED_LANGWATCH_API_KEY="+o.cfg.LocalAPIKey)
	}
	return env
}

// guardInheritedSeedEnv validates the database URLs a seed with no managed-DB
// overlay would inherit, resolved at the child's real precedence (process env
// over the merged dotenv layers).
func (o *Orchestrator) guardInheritedSeedEnv(lwDir string) error {
	return domain.GuardSeedTargets(domain.LoadDotenv(lwDir), os.Getenv)
}

// hasEnvKey reports whether a KEY=VALUE slice already sets key.
func hasEnvKey(env []string, key string) bool {
	prefix := key + "="
	for _, e := range env {
		if strings.HasPrefix(e, prefix) {
			return true
		}
	}
	return false
}

// seedSampleTraces ingests the deterministic demo traces through the running
// stack's collector — the real pipeline, not a ClickHouse side door — so the
// stack must be up. It talks to the app's loopback port over plain HTTP
// (portless terminates TLS in front of it; Node does not trust the proxy's CA).
func (o *Orchestrator) seedSampleTraces(ctx context.Context, p UpParams, retryCmd string) error {
	slug, err := o.resolveSlug(p)
	if err != nil {
		return err
	}
	st, ok := o.stackBySlug(slug)
	if !ok || !o.sys.ProcessAlive(st.LauncherPID) {
		return fmt.Errorf("stack %q is not running — sample traces go through the real collector, so start it (haven up) and re-run `%s`", slug, retryCmd)
	}
	var appPort int
	for _, svc := range st.Services {
		if svc.Name == "app" && !svc.IsFallback {
			appPort = svc.Port
		}
	}
	if appPort == 0 || !o.sys.PortInUse(appPort) {
		return fmt.Errorf("stack %q's app is not answering yet — wait for it to boot and re-run `%s`", slug, retryCmd)
	}
	env := []string{
		fmt.Sprintf("HAVEN_SEED_ENDPOINT=http://127.0.0.1:%d", appPort),
		"HAVEN_SEED_LANGWATCH_API_KEY=" + o.cfg.LocalAPIKey,
	}
	return o.sup.RunOnce(ctx, "seed-traces", p.LwDir, "pnpm run seed:sample-traces", env)
}

// runsLocally reports whether this worktree runs the service itself (vs falling
// back to the baseline). Only gateway and nlp are opt-out; app is always local.
func runsLocally(name string, opts PlanOptions) bool {
	switch name {
	case "gateway":
		return !opts.ShouldSkipGateway
	case "nlp":
		return !opts.ShouldSkipNLP
	case "langyagent":
		return !opts.ShouldSkipLangyAgent
	default:
		return true
	}
}

// slugOwnedByOther reports whether a registered stack from a different worktree
// already holds this slug — reusing it would overwrite their registry entry.
func (o *Orchestrator) slugOwnedByOther(slug, worktreeDir string) bool {
	for _, st := range o.store.Stacks() {
		if st.Slug == slug && st.WorktreeDir != worktreeDir {
			return true
		}
	}
	return false
}

// baselinePort routes an opted-out service's hostname to a live baseline stack.
func (o *Orchestrator) baselinePort(service string) (int, bool) {
	return domain.BaselinePort(o.store.Stacks(), service, o.sys.ProcessAlive)
}

func (o *Orchestrator) printStack(st domain.Stack) {
	fmt.Printf("\n  thuishaven: stack %q  (redis db %d)\n", st.Slug, st.RedisDB)
	for _, s := range st.Services {
		target := fmt.Sprintf("127.0.0.1:%d", s.Port)
		if s.IsFallback {
			target = fmt.Sprintf("baseline :%d", s.Port)
		}
		fmt.Printf("    %-10s %s  ->  %s\n", s.Name, s.URL, target)
		// The API shares app's origin — surface it right under app so the single
		// URL is obvious (no separate api.<slug> hostname to reach for).
		if s.Name == "app" && st.APIPort != 0 {
			fmt.Printf("    %-10s %s/api  ->  127.0.0.1:%d\n", "└ api", s.URL, st.APIPort)
		}
	}
	scheme, port := o.proxy.Endpoint()
	fmt.Printf("    %-10s %s\n\n", "hub", o.cfg.Naming.URL(domain.HubService, "", scheme, port))
}
