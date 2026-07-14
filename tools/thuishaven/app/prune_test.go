package app

import (
	"context"
	"testing"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// --- local fakes -------------------------------------------------------------
// The shared fakes live in hub_test.go (owned by another packet). The one hook
// they lack for prune is a worktree that reports uncommitted changes, so it is
// defined here rather than by editing hub_test.go.

// dirtyHygiene reports every worktree as dirty; the shared fakeHygiene always
// reports clean, and prune must skip a dirty worktree's database drop.
type dirtyHygiene struct{ *fakeHygiene }

func (dirtyHygiene) Dirty(string) bool { return true }

// pruneOrch builds a prune-ready orchestrator with both managed databases wired.
// It takes hyg as the Hygiene interface so a dirty variant can be substituted.
func pruneOrch(store *fakeStore, sys *fakeSystem, ch, pg *fakeDBServer, hyg Hygiene) *Orchestrator {
	return &Orchestrator{
		cfg:   Config{ShouldManageClickHouse: true, ShouldManagePostgres: true, Naming: domain.DefaultNaming("")},
		store: store, sys: sys, proxy: &fakeProxy{}, ch: ch, pg: pg, hyg: hyg,
		log: zap.NewNop(),
	}
}

// --- Prune database reclaim ---------------------------------------------------

func TestPruneDatabaseReclaim(t *testing.T) {
	repoRoot := "/repos/langwatch"
	victim := "/repos/worktrees/feat-x"
	ctx := context.Background()

	// newOrch wires one candidate worktree (victim) plus CH+PG each holding the
	// victim's database alongside the protected lw_main.
	newOrch := func(stacks []domain.Stack, alive map[int]bool, slugCache map[string]string) (*fakeDBServer, *fakeDBServer, *Orchestrator) {
		store := &fakeStore{stacks: stacks, slugCache: slugCache}
		sys := &fakeSystem{alive: alive}
		ch := &fakeDBServer{databases: []string{"lw_feat_x", "lw_main"}}
		pg := &fakeDBServer{databases: []string{"lw_feat_x", "lw_main"}}
		hyg := &fakeHygiene{worktrees: []Worktree{{Dir: victim}}}
		return ch, pg, pruneOrch(store, sys, ch, pg, hyg)
	}

	t.Run("given a safe worktree whose slug-cached databases exist", func(t *testing.T) {
		t.Run("when pruning as a dry run, it announces the drop without dropping", func(t *testing.T) {
			ch, pg, o := newOrch(nil, map[int]bool{}, map[string]string{victim: "feat-x"})
			if err := o.Prune(ctx, repoRoot, false); err != nil {
				t.Fatalf("Prune: %v", err)
			}
			if len(ch.dropped) != 0 || len(pg.dropped) != 0 {
				t.Errorf("a dry run must drop nothing, got ch=%v pg=%v", ch.dropped, pg.dropped)
			}
			would := o.pruneDatabases(ctx, victim, false, ch.databases, pg.databases)
			if len(would) != 2 {
				t.Errorf("dry run should report both databases as would-drop, got %v", would)
			}
		})

		t.Run("when pruning with --yes, it drops exactly the slug-cached database", func(t *testing.T) {
			ch, pg, o := newOrch(nil, map[int]bool{}, map[string]string{victim: "feat-x"})
			if err := o.Prune(ctx, repoRoot, true); err != nil {
				t.Fatalf("Prune: %v", err)
			}
			if len(ch.dropped) != 1 || ch.dropped[0] != "lw_feat_x" {
				t.Errorf("should drop only the slug-cached clickhouse db, got %v", ch.dropped)
			}
			if len(pg.dropped) != 1 || pg.dropped[0] != "lw_feat_x" {
				t.Errorf("should drop only the slug-cached postgres db, got %v", pg.dropped)
			}
		})
	})

	t.Run("given a worktree that never ran a stack (no slug cache)", func(t *testing.T) {
		t.Run("when pruning with --yes, its databases are untouched", func(t *testing.T) {
			ch, pg, o := newOrch(nil, map[int]bool{}, map[string]string{})
			if err := o.Prune(ctx, repoRoot, true); err != nil {
				t.Fatalf("Prune: %v", err)
			}
			if len(ch.dropped) != 0 || len(pg.dropped) != 0 {
				t.Errorf("a checkout with no cached slug must not be guessed at, got ch=%v pg=%v", ch.dropped, pg.dropped)
			}
		})
	})

	t.Run("given the worktree is up (a live registered stack)", func(t *testing.T) {
		t.Run("when pruning with --yes, its database survives", func(t *testing.T) {
			stacks := []domain.Stack{{Slug: "feat-x", WorktreeDir: victim, LauncherPID: 42}}
			ch, pg, o := newOrch(stacks, map[int]bool{42: true}, map[string]string{victim: "feat-x"})
			if err := o.Prune(ctx, repoRoot, true); err != nil {
				t.Fatalf("Prune: %v", err)
			}
			if len(ch.dropped) != 0 || len(pg.dropped) != 0 {
				t.Errorf("a live worktree's database must never be dropped, got ch=%v pg=%v", ch.dropped, pg.dropped)
			}
		})
	})

	t.Run("given the worktree is dirty", func(t *testing.T) {
		t.Run("when pruning with --yes, its database survives", func(t *testing.T) {
			store := &fakeStore{slugCache: map[string]string{victim: "feat-x"}}
			ch := &fakeDBServer{databases: []string{"lw_feat_x", "lw_main"}}
			pg := &fakeDBServer{databases: []string{"lw_feat_x", "lw_main"}}
			hyg := dirtyHygiene{&fakeHygiene{worktrees: []Worktree{{Dir: victim}}}}
			o := pruneOrch(store, &fakeSystem{alive: map[int]bool{}}, ch, pg, hyg)
			if err := o.Prune(ctx, repoRoot, true); err != nil {
				t.Fatalf("Prune: %v", err)
			}
			if len(ch.dropped) != 0 || len(pg.dropped) != 0 {
				t.Errorf("a dirty worktree's database must never be dropped, got ch=%v pg=%v", ch.dropped, pg.dropped)
			}
		})
	})
}

// --- pruneDatabases slug guards ----------------------------------------------

func TestPruneDatabasesSlugGuards(t *testing.T) {
	victim := "/repos/worktrees/feat-x"
	ctx := context.Background()

	t.Run("given a malformed cached slug", func(t *testing.T) {
		t.Run("when pruning its databases, nothing is dropped", func(t *testing.T) {
			store := &fakeStore{slugCache: map[string]string{victim: "Not A Slug!"}}
			o := pruneOrch(store, &fakeSystem{}, &fakeDBServer{}, &fakeDBServer{}, &fakeHygiene{})
			if got := o.pruneDatabases(ctx, victim, true, []string{"lw_feat_x"}, []string{"lw_feat_x"}); got != nil {
				t.Errorf("an unvalidated slug must not reach the DDL builders, got %v", got)
			}
		})
	})

	t.Run("given a forged cache naming a different, live worktree's slug", func(t *testing.T) {
		// victim itself is prunable, but its .langwatch-slug names "other", whose
		// stack is still running — dropping lw_other would wipe live data.
		t.Run("when pruning its databases, the live owner's database is spared", func(t *testing.T) {
			store := &fakeStore{
				slugCache: map[string]string{victim: "other"},
				stacks:    []domain.Stack{{Slug: "other", WorktreeDir: "/repos/worktrees/other", LauncherPID: 99}},
			}
			sys := &fakeSystem{alive: map[int]bool{99: true}}
			o := pruneOrch(store, sys, &fakeDBServer{}, &fakeDBServer{}, &fakeHygiene{})
			if got := o.pruneDatabases(ctx, victim, true, []string{"lw_other"}, []string{"lw_other"}); got != nil {
				t.Errorf("must not drop a database a live stack still owns, got %v", got)
			}
		})
	})
}

// --- drop --all protects lw_main ---------------------------------------------

func TestClickHouseDropAllProtectsMain(t *testing.T) {
	t.Run("given --all over a server holding lw_main and a feature db", func(t *testing.T) {
		t.Run("when dropping, only the feature db is dropped and lw_main is kept", func(t *testing.T) {
			ch := &fakeDBServer{databases: []string{"lw_main", "lw_feat_x"}}
			o := pruneOrch(&fakeStore{}, &fakeSystem{}, ch, &fakeDBServer{}, &fakeHygiene{})
			if err := o.clickHouseDrop(context.Background(), UpParams{}, true); err != nil {
				t.Fatalf("clickHouseDrop: %v", err)
			}
			if len(ch.dropped) != 1 || ch.dropped[0] != "lw_feat_x" {
				t.Errorf("only the feature db should be dropped, got %v", ch.dropped)
			}
		})
	})
}

func TestPostgresDropAllProtectsMain(t *testing.T) {
	t.Run("given --all over a server holding lw_main and a feature db", func(t *testing.T) {
		t.Run("when dropping, only the feature db is dropped and lw_main is kept", func(t *testing.T) {
			pg := &fakeDBServer{databases: []string{"lw_main", "lw_feat_x"}}
			o := pruneOrch(&fakeStore{}, &fakeSystem{}, &fakeDBServer{}, pg, &fakeHygiene{})
			if err := o.postgresDrop(context.Background(), UpParams{}, true); err != nil {
				t.Fatalf("postgresDrop: %v", err)
			}
			if len(pg.dropped) != 1 || pg.dropped[0] != "lw_feat_x" {
				t.Errorf("only the feature db should be dropped, got %v", pg.dropped)
			}
		})
	})
}
