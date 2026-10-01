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
	for _, eng := range []struct {
		name    string
		enabled bool
		srv     any
		drop    func(context.Context, string) error
	}{
		{"clickhouse", o.ch != nil && o.cfg.ShouldManageClickHouse, o.ch, func(c context.Context, db string) error { return o.ch.DropDatabase(c, db) }},
		{"postgres", o.pg != nil && o.cfg.ShouldManagePostgres, o.pg, func(c context.Context, db string) error { return o.pg.DropDatabase(c, db) }},
	} {
		lister, ok := eng.srv.(StrayLister)
		if !eng.enabled || !ok {
			continue
		}
		dbs, err := lister.StrayDatabases(ctx, ttl)
		if err != nil {
			if firstErr == nil {
				firstErr = fmt.Errorf("%s stray listing: %w", eng.name, err)
			}
			continue
		}
		for _, db := range dbs {
			if owned[db] || domain.IsProtectedDatabase(db) {
				continue
			}
			if shouldAct {
				if err := eng.drop(ctx, db); err != nil {
					o.log.Warn("stray-db prune: drop failed", zap.String("engine", eng.name), zap.String("db", db), zap.Error(err))
					continue
				}
			}
			out = append(out, fmt.Sprintf("%s (%s)", db, eng.name))
		}
	}
	return out, firstErr
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
