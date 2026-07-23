package app

import (
	"context"
	"fmt"
	"os"
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
	// container is the colima VM the langyagent worker runs on in its container
	// tiers (see domain.LangyTier). May be nil in tests that never launch it.
	container ContainerRuntime
	log       *zap.Logger
}

// New builds an Orchestrator from its injected dependencies.
func New(cfg Config, proxy Proxy, store Store, sup Supervisor, sys System, ch ClickHouse, pg Postgres, rds Redis, obs Observability, hyg Hygiene, sem Semaphore, container ContainerRuntime, log *zap.Logger) *Orchestrator {
	return &Orchestrator{cfg: cfg, proxy: proxy, store: store, sup: sup, sys: sys, ch: ch, pg: pg, rds: rds, obs: obs, hyg: hyg, sem: sem, container: container, log: log}
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
		HasStandaloneWorkers: opts.ShouldStartWorkers && opts.Selection.Workers,
		LangyTier:            opts.LangyTier,
		LangyImage:           opts.langyImageTag,
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

// Up is the launcher hook `pnpm dev:haven` runs in portless mode.
func (o *Orchestrator) Up(ctx context.Context, p UpParams, opts PlanOptions) error {
	// Bootstrap is part of up, not a command: a fresh machine installs portless,
	// trusts the CA, and starts the proxy right here (each step idempotent).
	if !o.proxy.Installed() {
		fmt.Println("portless is not installed — installing it (one time)…")
		if err := o.proxy.Install(); err != nil {
			return fmt.Errorf("could not install portless automatically (%w) — install it by hand (npm install -g portless) and re-run `haven up`", err)
		}
	}
	if err := o.proxy.EnsureReady(); err != nil {
		return fmt.Errorf("could not start the portless proxy: %w", err)
	}
	slug, err := o.resolveSlug(p)
	if err != nil {
		return err
	}
	// Resolve the langy image tag before anything else: it is pure file hashing,
	// and the reconcile guard needs it to notice a source edit under an
	// unchanged selection (same services, new bytes — still a restart).
	if opts.Selection.Langy && opts.LangyTier.RunsInContainer() {
		if tag, err := langyImageTag(opts.RepoRoot); err == nil {
			opts.langyImageTag = tag
		} else {
			o.log.Warn("could not derive the langy image tag — using the plain dev tag", zap.Error(err))
			opts.langyImageTag = langyImage
		}
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
	proceed, err := o.reconcileRunningStack(p, opts)
	if err != nil {
		return err
	}
	if !proceed {
		return nil
	}
	o.ensureDaemon(p.WorktreeDir)
	st, cleanup, err := o.provision(ctx, p, opts, true)
	if err != nil {
		return err
	}
	defer cleanup()
	endRegistration()
	fmt.Printf("  %s\n\n", opts.Selection.Describe())

	// Stale dependencies install themselves before anything needs them.
	if err := o.ensureDeps(ctx, p.LwDir); err != nil {
		return err
	}
	// DOTENV_CONFIG_QUIET drops dotenv v17's promo line for any one-shot script
	// that loads it via `import "dotenv/config"`; `pnpm -s` drops the lifecycle
	// banner. Keeps the codegen/prepare/seed lanes as quiet as the services.
	env := append(st.OverlayEnv(), "DOTENV_CONFIG_QUIET=true")
	// Codegen (prisma/zod/sdk-versions/mcp) then migrations — both finish before
	// the services boot. Owned here so `pnpm dev` is simply `haven up`.
	if err := o.sup.RunOnce(ctx, "codegen", p.LwDir, "pnpm -s run start:prepare:files", env); err != nil {
		o.log.Warn("codegen (start:prepare:files) failed (continuing)", zap.Error(err))
	}
	// Migrations failing on an existing database is the one prep step that must
	// STOP the up: continuing would boot the app onto a half-migrated schema,
	// and silently dropping the data to get past it is never haven's call.
	if err := o.sup.RunOnce(ctx, "prepare", p.LwDir, "pnpm -s run start:prepare:db", env); err != nil {
		return fmt.Errorf("migrations failed — nothing was dropped; fix the migration, or run `haven db reset` for a fresh database: %w", err)
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
		if err := o.sup.RunOnce(ctx, "seed", p.LwDir, seedShell("pnpm -s run prisma:seed", env), env); err != nil {
			o.log.Warn("seed failed (continuing)", zap.Error(err))
		}
	} else if err := o.guardInheritedSeedEnv(p.LwDir); err != nil {
		o.log.Warn("skipping seed — inherited database URL is not local", zap.Error(err))
		fmt.Printf("haven: %v — skipping seed\n", err)
	} else if err := o.sup.RunOnce(ctx, "seed", p.LwDir, seedShell("pnpm -s run prisma:seed", env), env); err != nil {
		o.log.Warn("seed failed (continuing)", zap.Error(err))
	}
	// In the container tiers (the sandboxed default and container-unsafe), the
	// langyagent worker runs on colima rather than the host. Bring the VM up and
	// ensure its image before planning; on failure, fail closed — skip langy rather
	// than silently dropping to the unsafe host runner — and tell the user the
	// explicit opt-in for host mode.
	langyDockerHost := ""
	if opts.Selection.Langy && st.LangyTier.RunsInContainer() {
		if dh, err := o.prepareLangyContainer(ctx, opts.RepoRoot, st.LangyImage, opts.ShouldRebuildImages); err != nil {
			o.log.Warn("langyagent container unavailable — skipping it (set LANGY_UNSAFE_HOST_ACCESS=1 to run the worker on the host instead)",
				zap.String("tier", st.LangyTier.String()), zap.Error(err))
			opts.Selection.Langy = false
		} else {
			langyDockerHost = dh
		}
	}
	o.sup.Supervise(ctx, o.planChildren(st, opts, p.LwDir, langyDockerHost))
	return nil
}

// prepareLangyContainer brings colima up and ensures the stack's
// content-addressed langy image exists on it, returning the docker socket the
// worker container should run against. Unchanged inputs → the tag already
// exists and this is a sub-second check; a configured registry may satisfy a
// new tag with a pull; otherwise it builds once, until the inputs change again.
func (o *Orchestrator) prepareLangyContainer(ctx context.Context, repoRoot, image string, forceRebuild bool) (string, error) {
	if o.container == nil {
		return "", fmt.Errorf("no container runtime configured")
	}
	if image == "" {
		image = langyImage
	}
	dockerHost, err := o.container.Ensure(ctx)
	if err != nil {
		return "", fmt.Errorf("colima (%s): %w", o.container.Profile(), err)
	}
	shell := langyImageEnsureShell(image, forceRebuild, langyImagePullRef(image))
	fmt.Printf("  langyagent: ensuring container image %s (a first build can take a few minutes)…\n", image)
	if err := o.sup.RunOnce(ctx, "langy-image", repoRoot, shell, []string{"DOCKER_HOST=" + dockerHost}); err != nil {
		return "", fmt.Errorf("build %s: %w", image, err)
	}
	return dockerHost, nil
}

// UpStub is the verification path: it provisions the stack exactly like Up, then
// stands echo servers up on the service ports (via the injected echo starter)
// instead of the real apps, so the whole resolve -> alias -> registry ->
// dashboard -> routing chain is exercised without Postgres/ClickHouse/Redis.
func (o *Orchestrator) UpStub(ctx context.Context, p UpParams, echo func(ports []int)) error {
	o.ensureDaemon(p.WorktreeDir)
	st, cleanup, err := o.provision(ctx, p, PlanOptions{
		Selection:          domain.Selection{Gateway: true, NLP: true, Langy: true},
		ShouldStartWorkers: true,
	}, false)
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

// reconcileRunningStack decides what `up` does about an already-running stack
// (ADR-064: no refusal, no force flag). Nothing registered — or a stale entry
// whose launcher died — is cleaned up and provisioning proceeds. A live stack
// that already matches the selection is a friendly no-op. A live stack with a
// different selection is taken over: the old launcher is terminated and waited
// on, and this process restarts the stack with the new selection.
func (o *Orchestrator) reconcileRunningStack(p UpParams, opts PlanOptions) (proceed bool, err error) {
	slug, err := o.resolveSlug(p)
	if err != nil {
		return false, err
	}
	st, ok := o.stackBySlug(slug)
	if !ok || st.LauncherPID == o.sys.Getpid() {
		return true, nil
	}
	if !o.sys.ProcessAlive(st.LauncherPID) {
		// A dead launcher's registry entry must never block up — clean it up.
		o.store.RemoveStack(slug)
		return true, nil
	}
	if !opts.ShouldForce && domain.SelectionFromStack(st) == opts.Selection && st.LangyImage == opts.langyImageTag {
		fmt.Printf("stack %q is already running (launcher pid %d) and matches the selection — nothing to do\n", slug, st.LauncherPID)
		fmt.Printf("  bounce a service: haven restart [service] · restart everything: haven up -f · stop: haven down\n")
		return false, nil
	}
	if opts.ShouldForce {
		fmt.Printf("stack %q is running — replacing it (-f)\n", slug)
	} else {
		fmt.Printf("stack %q is running with a different selection — restarting it here with the new one\n", slug)
	}
	o.sys.Terminate(st.LauncherPID)
	o.waitForProcessesDead([]int{st.LauncherPID})
	return true, nil
}

// Down tears the current worktree's stack down from anywhere: it stops a live
// launcher (the supervised children die with their process group), removes the
// routes, and drops the registry entry. Databases are KEPT, always — no flag
// on down can discard data; fresh data is `haven db reset`, and long-unused
// databases are pruned in the background by the daemon (DBIdleTTL) or via
// `haven clean`.
func (o *Orchestrator) Down(ctx context.Context, p UpParams, force bool) error {
	slug, err := o.resolveSlug(p)
	if err != nil {
		return err
	}
	if st, ok := o.stackBySlug(slug); ok && st.LauncherPID != o.sys.Getpid() && o.sys.ProcessAlive(st.LauncherPID) {
		if force {
			// -f: no grace — SIGKILL the launcher's whole process group at once,
			// for the stack that is wedged or just needs to be gone NOW.
			o.sys.KillGroup(st.LauncherPID)
			fmt.Printf("killed launcher group (pid %d) — -f skips graceful shutdown\n", st.LauncherPID)
		} else {
			o.sys.Terminate(st.LauncherPID)
			o.waitForProcessesDead([]int{st.LauncherPID})
			fmt.Printf("stopped launcher (pid %d)\n", st.LauncherPID)
		}
	}
	for _, r := range domain.PerWorktreeServices {
		o.proxy.Remove(r.Name, slug)
	}
	o.proxy.Remove(domain.ClickHouseService, slug)
	o.proxy.Remove(domain.PostgresService, slug)
	o.store.RemoveStack(slug)
	fmt.Printf("stack %q torn down (databases kept — `haven db reset` for fresh ones)\n", slug)
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

// seedShell wraps a prisma:seed command with a best-effort feature-flag upsert:
// once the seed lands, haven flips the dev feature set on (domain.SeededFeatureFlags)
// so a fresh stack opens on Langy, governance, and the event-sourced surfaces
// rather than the shipped-off defaults. Appended only when the seed targets a
// managed database — the env carries the provably-local per-slug DATABASE_URL
// (the same URL prisma:seed used); an inherited-.env seed is left untouched.
//
// The upsert is runtime-gated by HAVEN_SEED_FEATURE_FLAGS (set it to 0 to opt
// out) and chained with `|| echo` so a missing psql or a transient hiccup never
// fails the seed — enabling the dev feature set is a convenience, not a boot
// requirement. `key` is the FeatureFlag primary key, so the write is idempotent.
func seedShell(base string, env []string) string {
	if !hasEnvKey(env, "DATABASE_URL") {
		return base
	}
	sql := domain.FeatureFlagSeedSQL()
	if sql == "" {
		return base
	}
	return base + ` && if [ "$HAVEN_SEED_FEATURE_FLAGS" != "0" ]; then ` +
		`psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -qtA -c ` + shellSingleQuoted(sql) +
		` || echo "haven: feature-flag seed skipped (continuing)"; fi`
}

// shellSingleQuoted wraps s in single quotes for safe embedding in a bash -lc
// command, escaping any embedded single quotes via the '\” idiom.
func shellSingleQuoted(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
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
	env, err := o.liveSeedEnv(p, retryCmd)
	if err != nil {
		return err
	}
	return o.sup.RunOnce(ctx, "seed-traces", p.LwDir, "pnpm run seed:sample-traces", env)
}

// seedRealisticPlatformData adds coherent scenario, evaluation, and experiment
// lifecycles after the lightweight sample traces. It deliberately uses the
// collector + event-sourcing commands rather than inserting read models, so a
// demo seed exercises the event log and projection workers customers run.
func (o *Orchestrator) seedRealisticPlatformData(ctx context.Context, p UpParams, retryCmd string) error {
	env, err := o.liveSeedEnv(p, retryCmd)
	if err != nil {
		return err
	}
	return o.sup.RunOnce(ctx, "seed-platform", p.LwDir, "pnpm run seed:realistic-platform", env)
}

// liveSeedEnv returns the running stack's complete environment overlay plus a
// loopback collector endpoint. The complete overlay matters for seeders that
// write both Postgres and ClickHouse; inheriting langwatch/.env would silently
// target the primary checkout instead of this worktree's isolated databases.
func (o *Orchestrator) liveSeedEnv(p UpParams, retryCmd string) ([]string, error) {
	slug, err := o.resolveSlug(p)
	if err != nil {
		return nil, err
	}
	st, ok := o.stackBySlug(slug)
	if !ok || !o.sys.ProcessAlive(st.LauncherPID) {
		return nil, fmt.Errorf("stack %q is not running — sample data goes through the real collector, so start it (haven up) and re-run `%s`", slug, retryCmd)
	}
	var appPort int
	for _, svc := range st.Services {
		if svc.Name == "app" && !svc.IsFallback {
			appPort = svc.Port
		}
	}
	if appPort == 0 || !o.sys.PortInUse(appPort) {
		return nil, fmt.Errorf("stack %q's app is not answering yet — wait for it to boot and re-run `%s`", slug, retryCmd)
	}
	env := append([]string{}, st.OverlayEnv()...)
	env = append(env,
		fmt.Sprintf("HAVEN_SEED_ENDPOINT=http://127.0.0.1:%d", appPort),
		"HAVEN_SEED_LANGWATCH_API_KEY="+o.cfg.LocalAPIKey,
	)
	return env, nil
}

// runsLocally reports whether this worktree runs the service itself (vs
// falling back to the baseline), per its sticky selection. app is always local.
func runsLocally(name string, opts PlanOptions) bool {
	switch name {
	case "gateway":
		return opts.Selection.Gateway
	case "nlp":
		return opts.Selection.NLP
	case "langyagent":
		return opts.Selection.Langy
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
