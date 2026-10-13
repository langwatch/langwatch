package app

import (
	"context"
	"errors"
	"testing"
	"time"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// fakeLoadedClickHouse is a fakeDBServer that also answers the load probe.
type fakeLoadedClickHouse struct {
	fakeDBServer
	load     string
	queryErr error
	listErr  error
}

func (f *fakeLoadedClickHouse) Query(context.Context, string) (string, error) {
	return f.load, f.queryErr
}

func (f *fakeLoadedClickHouse) Databases(ctx context.Context) ([]string, error) {
	if f.listErr != nil {
		return nil, f.listErr
	}
	return f.fakeDBServer.Databases(ctx)
}

func TestPruneUnderClickHousePressure(t *testing.T) {
	ctx := context.Background()
	now := time.Date(2026, 10, 11, 12, 0, 0, 0, time.UTC)
	const overParts = "0\t5000\t100\t1000\n"
	const overMemory = "2\t10\t900\t1000\n"
	const calm = "2\t100\t100\t1000\n"

	newOrch := func(load string, stacks []domain.Stack) (*fakeStore, *fakeLoadedClickHouse, *fakeDBServer, *Orchestrator) {
		store := &fakeStore{stacks: stacks, dbActivity: map[string]time.Time{
			"oldest": now.Add(-48 * time.Hour),
			"older":  now.Add(-24 * time.Hour),
			"main":   now.Add(-1000 * time.Hour),
		}}
		ch := &fakeLoadedClickHouse{fakeDBServer: fakeDBServer{databases: []string{"lw_oldest", "lw_older", "lw_main"}}, load: load}
		pg := &fakeDBServer{databases: []string{"lw_oldest", "lw_older", "lw_main"}}
		o := &Orchestrator{
			cfg: Config{
				ClickHousePressure:     DefaultClickHousePressure(),
				ShouldManageClickHouse: true, ShouldManagePostgres: true, Naming: domain.DefaultNaming(""),
			},
			store: store, sys: &fakeSystem{now: now}, proxy: &fakeProxy{}, ch: ch, pg: pg, log: zap.NewNop(),
		}
		return store, ch, pg, o
	}

	t.Run("given clickhouse over the active-parts threshold", func(t *testing.T) {
		t.Run("when the daemon probes, only the oldest unowned database is dropped on both servers", func(t *testing.T) {
			store, ch, pg, o := newOrch(overParts, nil)
			o.pruneUnderClickHousePressure(ctx)
			if len(ch.dropped) != 1 || ch.dropped[0] != "lw_oldest" {
				t.Errorf("want only lw_oldest dropped from clickhouse, got %v", ch.dropped)
			}
			if len(pg.dropped) != 1 || pg.dropped[0] != "lw_oldest" {
				t.Errorf("want the postgres twin dropped too, got %v", pg.dropped)
			}
			if _, ok := store.dbActivity["oldest"]; ok {
				t.Error("the dropped slug's activity record should be removed")
			}
			if len(store.reapEvents) != 1 || store.reapEvents[0].Reason != "clickhouse under load" {
				t.Errorf("want one reap event with the load reason, got %v", store.reapEvents)
			}
		})
	})

	t.Run("given clickhouse over the memory threshold", func(t *testing.T) {
		t.Run("when the daemon probes, one database is dropped", func(t *testing.T) {
			_, ch, _, o := newOrch(overMemory, nil)
			o.pruneUnderClickHousePressure(ctx)
			if len(ch.dropped) != 1 {
				t.Errorf("want one drop at 90%% of the memory cap, got %v", ch.dropped)
			}
		})
	})

	t.Run("given the oldest slug has a registered stack", func(t *testing.T) {
		t.Run("when the daemon probes, the next oldest unowned database is dropped instead", func(t *testing.T) {
			_, ch, _, o := newOrch(overParts, []domain.Stack{{Slug: "oldest", LauncherPID: 9}})
			o.pruneUnderClickHousePressure(ctx)
			if len(ch.dropped) != 1 || ch.dropped[0] != "lw_older" {
				t.Errorf("a registered stack's database must survive, got %v", ch.dropped)
			}
		})
	})

	t.Run("given only the protected main database is unowned", func(t *testing.T) {
		t.Run("when the daemon probes, nothing is dropped", func(t *testing.T) {
			_, ch, pg, o := newOrch(overParts, []domain.Stack{{Slug: "oldest"}, {Slug: "older"}})
			o.pruneUnderClickHousePressure(ctx)
			if len(ch.dropped) != 0 || len(pg.dropped) != 0 {
				t.Errorf("lw_main must never be pressure-pruned, got ch=%v pg=%v", ch.dropped, pg.dropped)
			}
		})
	})

	t.Run("given clickhouse under every threshold", func(t *testing.T) {
		t.Run("when the daemon probes, nothing is dropped", func(t *testing.T) {
			_, ch, _, o := newOrch(calm, nil)
			o.pruneUnderClickHousePressure(ctx)
			if len(ch.dropped) != 0 {
				t.Errorf("a calm server must not lose databases, got %v", ch.dropped)
			}
		})
	})

	t.Run("given the thresholds are disabled", func(t *testing.T) {
		t.Run("when the daemon probes an overloaded server, nothing is dropped", func(t *testing.T) {
			_, ch, _, o := newOrch(overParts, nil)
			o.cfg.ClickHousePressure = ClickHousePressure{}
			o.pruneUnderClickHousePressure(ctx)
			if len(ch.dropped) != 0 {
				t.Errorf("zero thresholds disable the prune, got %v", ch.dropped)
			}
		})
	})

	t.Run("given the probe or a listing fails", func(t *testing.T) {
		t.Run("when the daemon probes, it fails closed", func(t *testing.T) {
			_, ch, _, o := newOrch(overParts, nil)
			ch.queryErr = errors.New("down")
			o.pruneUnderClickHousePressure(ctx)
			_, ch2, _, o2 := newOrch(overParts, nil)
			ch2.listErr = errors.New("down")
			o2.pruneUnderClickHousePressure(ctx)
			_, ch3, _, o3 := newOrch("garbage", nil)
			o3.pruneUnderClickHousePressure(ctx)
			if len(ch.dropped)+len(ch2.dropped)+len(ch3.dropped) != 0 {
				t.Errorf("an unreadable server must not lose databases, got %v %v %v", ch.dropped, ch2.dropped, ch3.dropped)
			}
		})
	})
}
