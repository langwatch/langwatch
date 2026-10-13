package app

import (
	"context"
	"fmt"
	"slices"
	"strconv"
	"strings"
	"time"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// ClickHousePressure is when the shared ClickHouse counts as overloaded. Either
// threshold over the line triggers a prune; 0 disables that threshold.
type ClickHousePressure struct {
	// MemoryPercent is MemoryTracking as a percentage of max_server_memory_usage.
	MemoryPercent int
	// ActiveParts is the server-wide count of active MergeTree parts.
	ActiveParts int
}

// DefaultClickHousePressure: queries start failing at 100% of the memory cap, so
// 85% acts first; 4000 parts is about a dozen idle stack databases (54 tables
// each) or a merge backlog the two-thread merge pool cannot clear.
func DefaultClickHousePressure() ClickHousePressure {
	return ClickHousePressure{MemoryPercent: 85, ActiveParts: 4000}
}

// clickHousePressureCycles is the probe cadence in monitor ticks (~2 minutes):
// long enough that one drop's relief shows before the next decision.
const clickHousePressureCycles = int((2 * time.Minute) / (10 * time.Second))

// LoadQuerier is implemented by a ClickHouse adapter that can run a read query.
// Optional, like StrayLister: an adapter without it is never probed.
type LoadQuerier interface {
	Query(ctx context.Context, sql string) (string, error)
}

// clickHouseLoad is one probe's reading of the server.
type clickHouseLoad struct {
	merges, activeParts, memory, memoryCap int64
}

const clickHouseLoadQuery = `SELECT
 (SELECT count() FROM system.merges),
 (SELECT count() FROM system.parts WHERE active),
 (SELECT value FROM system.metrics WHERE metric = 'MemoryTracking'),
 (SELECT toInt64OrZero(any(value)) FROM system.server_settings WHERE name = 'max_server_memory_usage')
FORMAT TabSeparated`

// overloaded names the first threshold the reading crosses ("" when none).
func (l clickHouseLoad) overloaded(p ClickHousePressure) string {
	if p.MemoryPercent > 0 && l.memoryCap > 0 && l.memory*100 >= l.memoryCap*int64(p.MemoryPercent) {
		return fmt.Sprintf("memory %d%% of cap", l.memory*100/l.memoryCap)
	}
	if p.ActiveParts > 0 && l.activeParts >= int64(p.ActiveParts) {
		return fmt.Sprintf("%d active parts", l.activeParts)
	}
	return ""
}

func parseClickHouseLoad(body string) (clickHouseLoad, error) {
	fields := strings.Fields(body)
	if len(fields) != 4 {
		return clickHouseLoad{}, fmt.Errorf("clickhouse load probe: want 4 fields, got %q", strings.TrimSpace(body))
	}
	var n [4]int64
	for i, f := range fields {
		v, err := strconv.ParseInt(f, 10, 64)
		if err != nil {
			return clickHouseLoad{}, fmt.Errorf("clickhouse load probe: %w", err)
		}
		n[i] = v
	}
	return clickHouseLoad{merges: n[0], activeParts: n[1], memory: n[2], memoryCap: n[3]}, nil
}

// pruneUnderClickHousePressure drops the one least recently used database no
// registered stack owns when the shared ClickHouse is over a threshold, with
// the idle prune's safety: fail closed on any listing error, never main.
func (o *Orchestrator) pruneUnderClickHousePressure(ctx context.Context) {
	p := o.cfg.ClickHousePressure
	if o.ch == nil || !o.cfg.ShouldManageClickHouse || (p.MemoryPercent <= 0 && p.ActiveParts <= 0) {
		return
	}
	q, ok := o.ch.(LoadQuerier)
	if !ok || !o.ch.Running() {
		return
	}
	body, err := q.Query(ctx, clickHouseLoadQuery)
	if err != nil {
		o.log.Warn("clickhouse load probe failed", zap.Error(err))
		return
	}
	load, err := parseClickHouseLoad(body)
	if err != nil {
		o.log.Warn("clickhouse load probe unreadable", zap.Error(err))
		return
	}
	reason := load.overloaded(p)
	if reason == "" {
		return
	}
	slug, db, pgHas, ok := o.oldestUnownedDatabase(ctx)
	if !ok {
		o.log.Info("clickhouse under load, nothing unowned to prune", zap.String("load", reason), zap.Int64("merges", load.merges))
		return
	}
	if err := o.ch.DropDatabase(ctx, db); err != nil {
		o.log.Warn("pressure prune: clickhouse drop failed", zap.String("db", db), zap.Error(err))
		return
	}
	if pgHas {
		if err := o.pg.DropDatabase(ctx, db); err != nil {
			o.log.Warn("pressure prune: postgres drop failed", zap.String("db", db), zap.Error(err))
			return
		}
	}
	o.store.RemoveDBActivity(slug)
	o.recordReap("database", db, "clickhouse under load")
	o.log.Info("pruned database under clickhouse load", zap.String("db", db), zap.String("load", reason), zap.Int64("merges", load.merges))
}

// oldestUnownedDatabase is the tracked ClickHouse database with the oldest idle
// clock that no registered stack owns and that is not protected. Postgres is
// listed too, so pgHas says whether its twin exists; either error aborts.
func (o *Orchestrator) oldestUnownedDatabase(ctx context.Context) (slug, db string, pgHas, ok bool) {
	chDBs, err := o.ch.Databases(ctx)
	if err != nil {
		return "", "", false, false
	}
	var pgDBs []string
	if o.pg != nil && o.cfg.ShouldManagePostgres {
		if pgDBs, err = o.pg.Databases(ctx); err != nil {
			return "", "", false, false
		}
	}
	registered := map[string]bool{}
	for _, st := range o.store.Stacks() {
		registered[st.Slug] = true
	}
	var oldest time.Time
	for s, lastSeen := range o.store.DBActivity() {
		if registered[s] || !domain.ValidSlug(s) {
			continue
		}
		d := domain.DatabaseForSlug(s)
		if domain.IsProtectedDatabase(d) || !slices.Contains(chDBs, d) {
			continue
		}
		if !ok || lastSeen.Before(oldest) || (lastSeen.Equal(oldest) && s < slug) {
			slug, db, oldest, ok = s, d, lastSeen, true
		}
	}
	return slug, db, ok && slices.Contains(pgDBs, db), ok
}
