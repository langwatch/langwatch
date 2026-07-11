package app

import (
	"context"
	"fmt"
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
	log   *zap.Logger
}

// New builds an Orchestrator from its injected dependencies. ch may be nil when
// ClickHouse management is disabled.
func New(cfg Config, proxy Proxy, store Store, sup Supervisor, sys System, ch ClickHouse, log *zap.Logger) *Orchestrator {
	return &Orchestrator{cfg: cfg, proxy: proxy, store: store, sup: sup, sys: sys, ch: ch, log: log}
}

// UpParams identify the worktree `up` runs in (resolved by the composition root).
type UpParams struct {
	WorktreeDir  string
	LwDir        string
	Branch       string
	ExplicitSlug string // from LANGWATCH_SLUG; wins over the derived/cached slug
}

// resolveSlug applies the precedence: explicit > cache > derived (then cached).
func (o *Orchestrator) resolveSlug(p UpParams) (string, error) {
	if p.ExplicitSlug != "" {
		if !domain.ValidSlug(p.ExplicitSlug) {
			return "", domain.ErrInvalidSlug(p.ExplicitSlug)
		}
		return p.ExplicitSlug, nil
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
// manageCH is set it also ensures the shared ClickHouse server + this stack's
// database before the overlay is written, so CLICKHOUSE_URL is in the overlay and
// the printed stack from the very first line.
func (o *Orchestrator) provision(ctx context.Context, p UpParams, manageCH bool) (domain.Stack, func(), error) {
	slug, err := o.resolveSlug(p)
	if err != nil {
		return domain.Stack{}, nil, err
	}
	ports, err := o.sys.FreePorts(5)
	if err != nil {
		return domain.Stack{}, nil, err
	}
	scheme, pport := o.proxy.Endpoint()
	// FreePorts(5): [0..2] the three routed services (app/gateway/nlp), [3] the
	// API backend that lives behind app's /api, [4] the worker metrics endpoint.
	st := domain.Stack{
		Slug: slug, WorktreeDir: p.WorktreeDir, Branch: p.Branch,
		LauncherPID: o.sys.Getpid(), RedisDB: domain.RedisDBForSlug(slug),
		APIPort: ports[3], WorkerMetricsPort: ports[4], LocalAPIKey: o.cfg.LocalAPIKey,
	}
	for i, r := range domain.PerWorktreeServices {
		st.Services = append(st.Services, domain.Service{
			Name: r.Name, Role: r.Role, Port: ports[i],
			Hostname: o.cfg.Naming.Hostname(r.Name, slug),
			URL:      o.cfg.Naming.URL(r.Name, slug, scheme, pport),
		})
	}

	for _, s := range st.Services {
		if err := o.proxy.Register(s.Name, slug, s.Port); err != nil {
			o.log.Warn("alias registration failed", zap.String("host", s.Hostname), zap.Error(err))
		}
	}
	if manageCH {
		o.ensureClickHouse(ctx, &st)
	}
	st.UpdatedAt = o.sys.Now()
	if err := o.store.WriteOverlay(p.LwDir, st); err != nil {
		return domain.Stack{}, nil, err
	}
	if err := o.store.SaveStack(st); err != nil {
		return domain.Stack{}, nil, err
	}
	o.printStack(st)
	go o.heartbeat(ctx, st)

	cleanup := func() {
		for _, s := range st.Services {
			o.proxy.Remove(s.Name, slug)
		}
		o.store.RemoveStack(slug)
	}
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

// Up is the launcher hook `pnpm dev` runs in portless mode.
func (o *Orchestrator) Up(ctx context.Context, p UpParams, opts PlanOptions) error {
	if !o.proxy.Running() {
		return fmt.Errorf("portless proxy is not running — run `make portless-setup` once to route by hostname")
	}
	o.ensureDaemon(p.WorktreeDir)
	st, cleanup, err := o.provision(ctx, p, true)
	if err != nil {
		return err
	}
	defer cleanup()

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
	if err := o.sup.RunOnce(ctx, "seed", p.LwDir, "pnpm run prisma:seed", env); err != nil {
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
	st, cleanup, err := o.provision(ctx, p, false)
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

// Down tears the current worktree's routes + registry entry down without needing
// the launcher process (useful after a crash). Unless keepDB is set it also drops
// this stack's ClickHouse database — the "give me a fresh DB" affordance — so the
// next `up` re-runs migrations into a clean, correctly-counted schema.
func (o *Orchestrator) Down(ctx context.Context, p UpParams, keepDB bool) error {
	slug, err := o.resolveSlug(p)
	if err != nil {
		return err
	}
	for _, r := range domain.PerWorktreeServices {
		o.proxy.Remove(r.Name, slug)
	}
	o.proxy.Remove(domain.ClickHouseService, slug)
	if o.ch != nil && o.cfg.ManageClickHouse && !keepDB {
		db := domain.DatabaseForSlug(slug)
		if err := o.ch.DropDatabase(ctx, db); err != nil {
			o.log.Warn("could not drop clickhouse database", zap.String("db", db), zap.Error(err))
		} else {
			fmt.Printf("dropped clickhouse database %q\n", db)
		}
	}
	o.store.RemoveStack(slug)
	fmt.Printf("stack %q torn down\n", slug)
	return nil
}

// ensureClickHouse starts the shared managed clickhouse-server (if not already
// up), creates this stack's isolated database, registers the always-resolving
// clickhouse.<slug> route, and records the endpoint on the stack so OverlayEnv
// emits CLICKHOUSE_URL. Failures are non-fatal: haven warns and leaves the app to
// fall back to whatever CLICKHOUSE_URL is pinned in .env.
func (o *Orchestrator) ensureClickHouse(ctx context.Context, st *domain.Stack) {
	if o.ch == nil || !o.cfg.ManageClickHouse {
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

// Seed reseeds the current stack's database — the "give me a fresh DB" affordance.
func (o *Orchestrator) Seed(ctx context.Context, p UpParams) error {
	return o.sup.RunOnce(ctx, "seed", p.LwDir, "pnpm run prisma:seed", nil)
}

func (o *Orchestrator) printStack(st domain.Stack) {
	fmt.Printf("\n  thuishaven: stack %q  (redis db %d)\n", st.Slug, st.RedisDB)
	for _, s := range st.Services {
		fmt.Printf("    %-10s %s  ->  127.0.0.1:%d\n", s.Name, s.URL, s.Port)
		// The API shares app's origin — surface it right under app so the single
		// URL is obvious (no separate api.<slug> hostname to reach for).
		if s.Name == "app" && st.APIPort != 0 {
			fmt.Printf("    %-10s %s/api  ->  127.0.0.1:%d\n", "└ api", s.URL, st.APIPort)
		}
	}
	scheme, port := o.proxy.Endpoint()
	fmt.Printf("    %-10s %s\n\n", "dashboard", o.cfg.Naming.URL(o.cfg.Naming.Project, "", scheme, port))
}
