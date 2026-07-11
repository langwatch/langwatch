package app

import (
	"context"
	"fmt"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// RunPostgres dispatches the `haven postgres <sub>` group: the manual control
// surface over the shared brew-managed Postgres.
func (o *Orchestrator) RunPostgres(ctx context.Context, p UpParams, args []string) error {
	// The adapter is always constructed, so a nil check would never fire — whether
	// haven manages Postgres is a config decision, not a wiring one.
	if !o.cfg.ShouldManagePostgres {
		return fmt.Errorf("postgres management is disabled (LANGWATCH_HAVEN_PG=0)")
	}
	sub := "status"
	rest := args
	if len(args) > 0 {
		sub, rest = args[0], args[1:]
	}
	switch sub {
	case "status":
		return o.postgresStatus(ctx, p)
	case "up":
		return o.postgresUp(ctx, p)
	case "url":
		return o.postgresURL(ctx, p)
	case "drop":
		return o.postgresDrop(ctx, p, hasFlagIn(rest, "--all"))
	default:
		return fmt.Errorf("unknown `haven postgres` subcommand %q (want status|up|url|drop)", sub)
	}
}

// ensureStackPostgresDatabase resolves the slug, starts the shared server if
// needed, and creates this stack's database — the common prelude of `up` and `url`.
func (o *Orchestrator) ensureStackPostgresDatabase(ctx context.Context, p UpParams) (port int, database string, err error) {
	slug, err := o.resolveSlug(p)
	if err != nil {
		return 0, "", err
	}
	port, err = o.pg.Ensure(ctx)
	if err != nil {
		return 0, "", err
	}
	database = domain.DatabaseForSlug(slug)
	if err := o.pg.EnsureDatabase(ctx, database); err != nil {
		return 0, "", err
	}
	return port, database, nil
}

func (o *Orchestrator) postgresUp(ctx context.Context, p UpParams) error {
	port, db, err := o.ensureStackPostgresDatabase(ctx, p)
	if err != nil {
		return err
	}
	fmt.Printf("managed postgres up on :%d — database %q ready\n", port, db)
	return nil
}

// postgresURL ensures the server + database and prints this stack's
// DATABASE_URL — the value haven writes into the overlay, useful by hand.
func (o *Orchestrator) postgresURL(ctx context.Context, p UpParams) error {
	port, db, err := o.ensureStackPostgresDatabase(ctx, p)
	if err != nil {
		return err
	}
	fmt.Printf("postgresql://%s:%s@127.0.0.1:%d/%s\n", domain.PostgresRole, domain.PostgresRolePassword, port, db)
	return nil
}

func (o *Orchestrator) postgresStatus(ctx context.Context, p UpParams) error {
	slug, _ := o.resolveSlug(p)
	ok, detail := o.pg.Health(ctx)
	state := "down"
	if ok {
		state = "up"
	}
	fmt.Printf("managed postgres: %s (%s)\n", state, detail)
	if port := o.pg.Port(); port != 0 {
		fmt.Printf("  port           : %d\n", port)
	}
	if slug != "" {
		db := domain.DatabaseForSlug(slug)
		fmt.Printf("  this stack     : %s  ->  postgresql://%s:%s@127.0.0.1:%d/%s\n",
			db, domain.PostgresRole, domain.PostgresRolePassword, o.pg.Port(), db)
	}
	if dbs, err := o.pg.Databases(ctx); err == nil && len(dbs) > 0 {
		fmt.Printf("  databases (%d) : %v\n", len(dbs), dbs)
	}
	return nil
}

// postgresDrop drops this stack's database, or every lw_* database with --all.
func (o *Orchestrator) postgresDrop(ctx context.Context, p UpParams, all bool) error {
	if all {
		dbs, err := o.pg.Databases(ctx)
		if err != nil {
			return err
		}
		for _, db := range dbs {
			if err := o.pg.DropDatabase(ctx, db); err != nil {
				return err
			}
			fmt.Printf("dropped %q\n", db)
		}
		return nil
	}
	slug, err := o.resolveSlug(p)
	if err != nil {
		return err
	}
	db := domain.DatabaseForSlug(slug)
	if err := o.pg.DropDatabase(ctx, db); err != nil {
		return err
	}
	fmt.Printf("dropped %q\n", db)
	return nil
}
