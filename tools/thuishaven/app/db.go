// The `haven db` noun: every explicit operation on this stack's data lives
// here — reset (drop + migrate + seed, the one destructive verb) and url (the
// connection strings). Server lifecycle is not a command: the shared
// ClickHouse / Postgres / Redis servers are ensured automatically wherever
// they are needed, and `haven down --all` is the one way to stop everything.
package app

import (
	"context"
	"fmt"
	"sort"
	"strings"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// seedPreset is one seed variant: env switches for prisma:seed plus which
// post-seed ingest steps run through the live stack's collector. Presets are
// positional (`haven db seed demo`), validated against this registry, and the
// same set works on reset (`haven db reset demo`).
type seedPreset struct {
	env []string
	// ingest is the ordered list of live-stack pnpm scripts to run after the
	// base seed — they go through the running stack's real collector and
	// event-sourcing commands, so the stack must be up.
	ingest  []string
	summary string
}

// seedPresets is the registry of variants, shared by `db seed` and `db reset`.
var seedPresets = map[string]seedPreset{
	"demo":            {env: []string{"HAVEN_SEED_PRESET=demo"}, ingest: []string{"seed:sample-traces", "seed:realistic-platform"}, summary: "past onboarding + sample traces + realistic platform data"},
	"traces":          {ingest: []string{"seed:sample-traces"}, summary: "the deterministic sample traces on top of the stable identity"},
	"onboarding":      {env: []string{"HAVEN_SEED_FIRST_MESSAGE=0"}, summary: "a fresh onboarding journey (first-trace flag cleared)"},
	"post-onboarding": {env: []string{"HAVEN_SEED_FIRST_MESSAGE=1"}, summary: "past onboarding, no demo content"},
	"bare":            {env: []string{"HAVEN_SEED_MODEL_PROVIDERS=0", "HAVEN_SEED_FEATURE_FLAGS=0"}, summary: "identity only — no env-derived providers, stock feature flags"},
	// mass: months of coherent, backdated activity across every product —
	// event-sourced products are seeded through their event logs (replayed by
	// the projection workers), traces backdate through the collector.
	// HAVEN_SEED_MONTHS tunes the window (default 3).
	"mass": {env: []string{"HAVEN_SEED_PRESET=demo"}, ingest: []string{"seed:sample-traces", "seed:mass"}, summary: "months of backdated activity across every product (HAVEN_SEED_MONTHS, default 3)"},
}

// SeedPresetNames lists the registry for errors and help, sorted.
func SeedPresetNames() []string {
	names := make([]string, 0, len(seedPresets))
	for name := range seedPresets {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}

// resolveSeedPreset validates a preset name ("" is the plain identity seed).
func resolveSeedPreset(name string) (seedPreset, error) {
	if name == "" {
		return seedPreset{}, nil
	}
	pre, ok := seedPresets[name]
	if !ok {
		return seedPreset{}, fmt.Errorf("unknown seed preset %q — available: %s", name, strings.Join(SeedPresetNames(), ", "))
	}
	return pre, nil
}

// DBReset gives this stack fresh databases: drop, recreate, migrate, seed.
// Every failure is hard — a reset that silently kept old data (or stopped
// half-way) would let the next `up` reuse stale state while the developer
// believes it is clean. The confirmation ceremony is the caller's job.
func (o *Orchestrator) DBReset(ctx context.Context, p UpParams, preset string) error {
	pre, err := resolveSeedPreset(preset)
	if err != nil {
		return err
	}
	slug, err := o.resolveSlug(p)
	if err != nil {
		return err
	}
	if !o.cfg.ShouldManageClickHouse && !o.cfg.ShouldManagePostgres {
		return fmt.Errorf("database management is disabled (LANGWATCH_HAVEN_CH=0 and LANGWATCH_HAVEN_PG=0) — haven cannot reset databases it does not manage")
	}
	db := domain.DatabaseForSlug(slug)
	if o.ch != nil && o.cfg.ShouldManageClickHouse {
		if _, err := o.ch.Ensure(ctx); err != nil {
			return fmt.Errorf("managed clickhouse is unavailable: %w", err)
		}
		if err := o.ch.DropDatabase(ctx, db); err != nil {
			return fmt.Errorf("dropping clickhouse database %q: %w", db, err)
		}
		fmt.Printf("dropped clickhouse database %q\n", db)
	}
	if o.pg != nil && o.cfg.ShouldManagePostgres {
		if _, err := o.pg.Ensure(ctx); err != nil {
			return fmt.Errorf("managed postgres is unavailable: %w", err)
		}
		if err := o.pg.DropDatabase(ctx, db); err != nil {
			return fmt.Errorf("dropping postgres database %q: %w", db, err)
		}
		fmt.Printf("dropped postgres database %q\n", db)
	}

	env, err := o.managedStackEnv(ctx, slug)
	if err != nil {
		return err
	}
	env = append(env, "DOTENV_CONFIG_QUIET=true")
	env = append(env, pre.env...)
	if err := o.sup.RunOnce(ctx, "prepare", p.LwDir, "pnpm -s run start:prepare:db", env); err != nil {
		return fmt.Errorf("migrations failed on the fresh database: %w", err)
	}
	if err := o.sup.RunOnce(ctx, "seed", p.LwDir, seedShell("pnpm -s run prisma:seed", env), env); err != nil {
		return fmt.Errorf("seed failed: %w", err)
	}
	fmt.Printf("stack %q databases reset — migrated and seeded fresh\n", slug)
	return o.runSeedIngest(ctx, p, pre, "haven db reset "+preset)
}

// runSeedIngest runs a preset's live-stack ingest scripts in order after the
// base seed landed.
func (o *Orchestrator) runSeedIngest(ctx context.Context, p UpParams, pre seedPreset, retryCmd string) error {
	for _, script := range pre.ingest {
		if err := o.runIngestScript(ctx, p, retryCmd, script); err != nil {
			return err
		}
	}
	return nil
}

// managedStackEnv builds the environment a database-rebuilding child runs
// with: the managed servers are ensured (recreating this slug's freshly
// dropped databases empty), then the registered stack's full overlay is
// preferred when one exists — it carries the same database URLs plus
// everything else a seeder might dial. Unlike `up`'s warn-and-continue
// ensures, an unavailable managed server is a hard error here: there is no
// .env fallback that could make "reset the managed database" mean anything.
func (o *Orchestrator) managedStackEnv(ctx context.Context, slug string) ([]string, error) {
	st := domain.Stack{Slug: slug, RedisDB: domain.RedisDBForSlug(slug), LocalAPIKey: o.cfg.LocalAPIKey}
	o.ensureClickHouse(ctx, &st)
	o.ensurePostgres(ctx, &st)
	o.ensureRedis(ctx, &st)
	if o.cfg.ShouldManageClickHouse && st.ClickHouseDatabase == "" {
		return nil, fmt.Errorf("managed clickhouse is unavailable — cannot rebuild database %q", domain.DatabaseForSlug(slug))
	}
	if o.cfg.ShouldManagePostgres && st.PostgresDatabase == "" {
		return nil, fmt.Errorf("managed postgres is unavailable — cannot rebuild database %q", domain.DatabaseForSlug(slug))
	}
	if reg, ok := o.stackBySlug(slug); ok {
		return reg.OverlayEnv(), nil
	}
	return st.OverlayEnv(), nil
}

// DBSeed reseeds this stack's database WITHOUT dropping anything — the
// idempotent, non-destructive sibling of DBReset. The seed is an upsert (a
// no-op once the stable identity exists), so it needs no confirmation: it can
// only add or refresh, never discard. preset ("" = plain identity) picks a
// variant from the registry.
func (o *Orchestrator) DBSeed(ctx context.Context, p UpParams, preset string) error {
	pre, err := resolveSeedPreset(preset)
	if err != nil {
		return err
	}
	env := append(o.seedEnv(p), pre.env...)
	if err := o.sup.RunOnce(ctx, "seed", p.LwDir, seedShell("pnpm -s run prisma:seed", env), env); err != nil {
		return fmt.Errorf("seed failed: %w", err)
	}
	return o.runSeedIngest(ctx, p, pre, "haven db seed "+preset)
}

// seedEnv builds the environment for a non-destructive seed: the registered
// stack's overlay when one exists (so the seed writes into this worktree's
// per-slug databases rather than whatever DATABASE_URL is inherited), always
// carrying HAVEN_SEED_LANGWATCH_API_KEY so a re-seed keeps the well-known
// local key instead of rotating it (a rotation would 401 the trace ingest).
// With no stack registered the child inherits the (guarded) environment.
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

// DBURL prints this stack's connection string for one engine — or all of
// them, labelled, when engine is empty. It ensures the server (and this
// stack's database) exists first, so the printed string always works.
func (o *Orchestrator) DBURL(ctx context.Context, p UpParams, engine string) error {
	slug, err := o.resolveSlug(p)
	if err != nil {
		return err
	}
	db := domain.DatabaseForSlug(slug)
	label := func(name string) string {
		if engine != "" {
			return ""
		}
		return fmt.Sprintf("%-11s ", name)
	}
	printPostgres := func() error {
		if o.pg == nil || !o.cfg.ShouldManagePostgres {
			return fmt.Errorf("postgres management is disabled (LANGWATCH_HAVEN_PG=0) — DATABASE_URL comes from .env")
		}
		port, err := o.pg.Ensure(ctx)
		if err != nil {
			return err
		}
		if err := o.pg.EnsureDatabase(ctx, db); err != nil {
			return err
		}
		fmt.Printf("%spostgresql://%s:%s@127.0.0.1:%d/%s\n", label("postgres"), domain.PostgresRole, domain.PostgresRolePassword, port, db)
		return nil
	}
	printClickHouse := func() error {
		if o.ch == nil || !o.cfg.ShouldManageClickHouse {
			return fmt.Errorf("clickhouse management is disabled (LANGWATCH_HAVEN_CH=0) — CLICKHOUSE_URL comes from .env")
		}
		port, err := o.ch.Ensure(ctx)
		if err != nil {
			return err
		}
		if err := o.ch.EnsureDatabase(ctx, db); err != nil {
			return err
		}
		fmt.Printf("%shttp://%s:%s@127.0.0.1:%d/%s\n", label("clickhouse"), domain.ClickHouseUser, domain.ClickHousePassword, port, db)
		return nil
	}
	printRedis := func() error {
		if o.rds == nil || !o.cfg.ShouldManageRedis {
			return fmt.Errorf("redis management is disabled (LANGWATCH_HAVEN_REDIS=0) — REDIS_URL comes from .env")
		}
		port, err := o.rds.Ensure(ctx)
		if err != nil {
			return err
		}
		fmt.Printf("%sredis://127.0.0.1:%d/%d\n", label("redis"), port, domain.RedisDBForSlug(slug))
		return nil
	}
	switch engine {
	case "postgres":
		return printPostgres()
	case "clickhouse":
		return printClickHouse()
	case "redis":
		return printRedis()
	case "":
		for _, print := range []func() error{printPostgres, printClickHouse, printRedis} {
			if err := print(); err != nil {
				return err
			}
		}
		return nil
	default:
		return fmt.Errorf("unknown engine %q — postgres, clickhouse, or redis", engine)
	}
}

// DownAll is `haven down --all`: stop every stack, the observability stack,
// the managed ClickHouse container, the daemon, and the proxy — everything
// haven runs on this machine. Data is kept: the ClickHouse volume and the
// Postgres/Redis servers' data survive (Postgres and Redis themselves are
// brew-managed machine-wide services haven deliberately never stops).
func (o *Orchestrator) DownAll(ctx context.Context) error {
	var stopped []int
	for _, st := range o.store.Stacks() {
		if o.sys.ProcessAlive(st.LauncherPID) {
			stopped = append(stopped, st.LauncherPID)
		}
		if err := o.DownStack(ctx, st.Slug); err != nil {
			o.log.Warn("down --all: stack down failed (continuing)", zap.String("slug", st.Slug), zap.Error(err))
			continue
		}
		fmt.Printf("stopped stack %q\n", st.Slug)
	}
	o.waitForProcessesDead(stopped)
	if o.obs != nil && o.obs.IsRunning(ctx) {
		if err := o.obs.Stop(ctx); err != nil {
			o.log.Warn("down --all: observability stop failed", zap.Error(err))
		} else {
			o.proxy.Remove(domain.ObservabilityService, "")
			fmt.Println("stopped observability stack (collected telemetry discarded — it keeps no volume)")
		}
	}
	if o.ch != nil && o.cfg.ShouldManageClickHouse && o.ch.Running() {
		o.ch.Stop()
		fmt.Println("stopped managed clickhouse-server (data kept)")
	}
	if info, ok := o.store.Daemon(); ok && o.sys.ProcessAlive(info.PID) {
		o.sys.Terminate(info.PID)
		o.store.ClearDaemon()
		fmt.Printf("stopped haven daemon (pid %d)\n", info.PID)
	}
	if err := o.proxy.Shutdown(); err != nil {
		o.log.Warn("down --all: proxy stop failed (continuing)", zap.Error(err))
	} else {
		fmt.Println("stopped portless proxy")
	}
	fmt.Println("everything haven runs is stopped; databases are kept")
	return nil
}
