package app

import (
	"context"
	"fmt"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// RunClickHouse dispatches the `haven clickhouse <sub>` group: the manual control
// surface over the shared managed clickhouse-server. It is also the clean entry
// the verification harness drives (start a server, mint a per-slug URL, list
// databases) without booting the whole stack.
func (o *Orchestrator) RunClickHouse(ctx context.Context, p UpParams, args []string) error {
	if o.ch == nil {
		return fmt.Errorf("clickhouse management is disabled (set LANGWATCH_HAVEN_CH=1)")
	}
	sub := "status"
	rest := args
	if len(args) > 0 {
		sub, rest = args[0], args[1:]
	}
	switch sub {
	case "status":
		return o.clickHouseStatus(ctx, p)
	case "up":
		return o.clickHouseUp(ctx, p)
	case "url":
		return o.clickHouseURL(ctx, p)
	case "stop":
		o.ch.Stop()
		fmt.Println("managed clickhouse-server stopped")
		return nil
	case "drop":
		return o.clickHouseDrop(ctx, p, hasFlagIn(rest, "--all"))
	default:
		return fmt.Errorf("unknown `haven clickhouse` subcommand %q (want status|up|url|stop|drop)", sub)
	}
}

// clickHouseUp ensures the shared server and this stack's database exist.
func (o *Orchestrator) clickHouseUp(ctx context.Context, p UpParams) error {
	slug, err := o.resolveSlug(p)
	if err != nil {
		return err
	}
	port, err := o.ch.Ensure(ctx)
	if err != nil {
		return err
	}
	db := domain.DatabaseForSlug(slug)
	if err := o.ch.EnsureDatabase(ctx, db); err != nil {
		return err
	}
	fmt.Printf("managed clickhouse up on :%d — database %q ready\n", port, db)
	return nil
}

// clickHouseURL ensures the server + database and prints this stack's
// CLICKHOUSE_URL — the value haven writes into the overlay, useful by hand.
func (o *Orchestrator) clickHouseURL(ctx context.Context, p UpParams) error {
	slug, err := o.resolveSlug(p)
	if err != nil {
		return err
	}
	port, err := o.ch.Ensure(ctx)
	if err != nil {
		return err
	}
	db := domain.DatabaseForSlug(slug)
	if err := o.ch.EnsureDatabase(ctx, db); err != nil {
		return err
	}
	fmt.Printf("http://127.0.0.1:%d/%s\n", port, db)
	return nil
}

// clickHouseStatus reports the shared server and every stack database on it.
func (o *Orchestrator) clickHouseStatus(ctx context.Context, p UpParams) error {
	slug, _ := o.resolveSlug(p)
	ok, detail := o.ch.Health(ctx)
	state := "down"
	if ok {
		state = "up"
	}
	fmt.Printf("managed clickhouse: %s (%s)\n", state, detail)
	if port := o.ch.HTTPPort(); port != 0 {
		fmt.Printf("  http port      : %d\n", port)
	}
	if slug != "" {
		db := domain.DatabaseForSlug(slug)
		fmt.Printf("  this stack     : %s  ->  http://127.0.0.1:%d/%s\n", db, o.ch.HTTPPort(), db)
	}
	if dbs, err := o.ch.Databases(ctx); err == nil && len(dbs) > 0 {
		fmt.Printf("  databases (%d) : %v\n", len(dbs), dbs)
	}
	return nil
}

// clickHouseDrop drops this stack's database, or every lw_* database with --all.
func (o *Orchestrator) clickHouseDrop(ctx context.Context, p UpParams, all bool) error {
	if all {
		dbs, err := o.ch.Databases(ctx)
		if err != nil {
			return err
		}
		for _, db := range dbs {
			if err := o.ch.DropDatabase(ctx, db); err != nil {
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
	if err := o.ch.DropDatabase(ctx, db); err != nil {
		return err
	}
	fmt.Printf("dropped %q\n", db)
	return nil
}

func hasFlagIn(args []string, flag string) bool {
	for _, a := range args {
		if a == flag {
			return true
		}
	}
	return false
}
