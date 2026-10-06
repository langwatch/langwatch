package app

import (
	"context"
	"fmt"
	"strings"
	"time"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// StrayLister is implemented by a database server adapter that can name
// databases haven did not create (test suites, apidiff runs) and that have sat
// untouched for olderThan. Optional: an adapter without it has no strays.
type StrayLister interface {
	StrayDatabases(ctx context.Context, olderThan time.Duration) ([]string, error)
}

// PruneStrayDatabases drops (shouldAct) or lists ClickHouse test_*, lw_apidiff_*
// and langwatch* databases and Postgres lw_*_test / lw_*_ci databases older than
// HAVEN_DB_TTL. A database a registered stack owns, and the protected main
// database, are never touched. Returns "name (engine)" for each.
func (o *Orchestrator) PruneStrayDatabases(ctx context.Context, shouldAct bool) ([]string, error) {
	ttl := o.cfg.DBIdleTTL
	if ttl <= 0 {
		return nil, nil
	}
	owned := map[string]bool{}
	for _, st := range o.store.Stacks() {
		owned[domain.DatabaseForSlug(st.Slug)] = true
	}
	var out []string
	var firstErr error
	for _, eng := range o.strayEngines() {
		dbs, err := eng.lister.StrayDatabases(ctx, ttl)
		if err != nil {
			if firstErr == nil {
				firstErr = fmt.Errorf("%s stray listing: %w", eng.name, err)
			}
			continue
		}
		out = append(out, o.pruneStrays(ctx, strayPrune{engine: eng, owned: owned, shouldAct: shouldAct}, dbs)...)
	}
	return out, firstErr
}

// strayEngine is a database server haven may prune strays on.
type strayEngine struct {
	name   string
	lister StrayLister
	drop   func(context.Context, string) error
}

// strayEngines is each managed server whose adapter can list strays.
func (o *Orchestrator) strayEngines() []strayEngine {
	var out []strayEngine
	for _, eng := range []struct {
		name    string
		enabled bool
		srv     any
		drop    func(context.Context, string) error
	}{
		{"clickhouse", o.ch != nil && o.cfg.ShouldManageClickHouse, o.ch, func(c context.Context, db string) error { return o.ch.DropDatabase(c, db) }},
		{"postgres", o.pg != nil && o.cfg.ShouldManagePostgres, o.pg, func(c context.Context, db string) error { return o.pg.DropDatabase(c, db) }},
	} {
		if lister, ok := eng.srv.(StrayLister); eng.enabled && ok {
			out = append(out, strayEngine{name: eng.name, lister: lister, drop: eng.drop})
		}
	}
	return out
}

// strayPrune is one engine's pass: the databases stacks own, which are never
// touched, and whether to drop or only list.
type strayPrune struct {
	engine    strayEngine
	owned     map[string]bool
	shouldAct bool
}

// pruneStrays drops (or lists) each unowned, unprotected database, returning
// "name (engine)" for each; a failed drop is logged and left out.
func (o *Orchestrator) pruneStrays(ctx context.Context, pass strayPrune, dbs []string) []string {
	eng := pass.engine
	var out []string
	for _, db := range dbs {
		if pass.owned[db] || domain.IsProtectedDatabase(db) {
			continue
		}
		if pass.shouldAct {
			if err := eng.drop(ctx, db); err != nil {
				o.log.Warn("stray-db prune: drop failed", zap.String("engine", eng.name), zap.String("db", db), zap.Error(err))
				continue
			}
		}
		out = append(out, fmt.Sprintf("%s (%s)", db, eng.name))
	}
	return out
}

// pruneStrayDatabasesQuietly is the daemon's unattended pass.
func (o *Orchestrator) pruneStrayDatabasesQuietly(ctx context.Context) {
	dropped, err := o.PruneStrayDatabases(ctx, true)
	if err != nil {
		o.log.Warn("stray-db prune", zap.Error(err))
	}
	if len(dropped) > 0 {
		o.log.Info("pruned stray databases", zap.String("dbs", strings.Join(dropped, ", ")))
	}
}
