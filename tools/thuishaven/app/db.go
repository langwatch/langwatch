// The `haven db` noun: every explicit operation on this stack's data lives
// here — reset (drop + migrate + seed, the one destructive verb) and url (the
// connection strings). Server lifecycle is not a command: the shared
// ClickHouse / Postgres / Redis servers are ensured automatically wherever
// they are needed, and `haven down --all` is the one way to stop everything.
package app

import (
	"context"
	"fmt"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// DBResetOptions tune `haven db reset`.
type DBResetOptions struct {
	// Demo seeds the demo preset after the reset: onboarding marked done, sample
	// traces + realistic platform data ingested through the running stack's real
	// collector (the stack must be up for that part).
	Demo bool
}

// DBReset gives this stack fresh databases: drop, recreate, migrate, seed.
// Every failure is hard — a reset that silently kept old data (or stopped
// half-way) would let the next `up` reuse stale state while the developer
// believes it is clean. The confirmation ceremony is the caller's job.
func (o *Orchestrator) DBReset(ctx context.Context, p UpParams, opts DBResetOptions) error {
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
	if opts.Demo {
		env = append(env, "HAVEN_SEED_PRESET=demo")
	}
	if err := o.sup.RunOnce(ctx, "prepare", p.LwDir, "pnpm -s run start:prepare:db", env); err != nil {
		return fmt.Errorf("migrations failed on the fresh database: %w", err)
	}
	if err := o.sup.RunOnce(ctx, "seed", p.LwDir, seedShell("pnpm -s run prisma:seed", env), env); err != nil {
		return fmt.Errorf("seed failed: %w", err)
	}
	fmt.Printf("stack %q databases reset — migrated and seeded fresh\n", slug)
	if !opts.Demo {
		return nil
	}
	const retryCmd = "haven db reset --demo"
	if err := o.seedSampleTraces(ctx, p, retryCmd); err != nil {
		return err
	}
	return o.seedRealisticPlatformData(ctx, p, retryCmd)
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
