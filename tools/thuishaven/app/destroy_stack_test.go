package app

import (
	"context"
	"slices"
	"testing"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// DestroyStack is the slug-addressed wipe a tool's teardown runs. What these
// cases pin is the blast radius: one slug in, one stack down, one database
// pair dropped, every neighbor untouched.
func TestDestroyStack(t *testing.T) {
	ctx := context.Background()
	const mine, neighbor = "run-20260909t2230-branch", "feat-strict-feature-layout-v0"

	newOrch := func(stacks []domain.Stack) (*fakeDBServer, *fakeDBServer, *fakeStore, *Orchestrator) {
		store := &fakeStore{stacks: stacks}
		ch := &fakeDBServer{databases: []string{"lw_run_20260909t2230_branch", "lw_feat_strict_feature_layout_v0", "lw_main"}}
		pg := &fakeDBServer{databases: []string{"lw_run_20260909t2230_branch", "lw_feat_strict_feature_layout_v0", "lw_main"}}
		return ch, pg, store, pruneOrch(store, &fakeSystem{alive: map[int]bool{}}, ch, pg, &fakeHygiene{})
	}

	t.Run("given two registered stacks", func(t *testing.T) {
		t.Run("when one is destroyed by slug, only its stack and its databases go", func(t *testing.T) {
			ch, pg, store, o := newOrch([]domain.Stack{
				{Slug: mine, WorktreeDir: "/repos/langwatch", LauncherPID: 4242},
				{Slug: neighbor, WorktreeDir: "/repos/langwatch", LauncherPID: 99},
			})
			if err := o.DestroyStack(ctx, mine); err != nil {
				t.Fatalf("DestroyStack: %v", err)
			}
			want := []string{"lw_run_20260909t2230_branch"}
			if !slices.Equal(ch.dropped, want) || !slices.Equal(pg.dropped, want) {
				t.Errorf("dropped ch=%v pg=%v, want %v on each", ch.dropped, pg.dropped, want)
			}
			remaining := store.Stacks()
			if len(remaining) != 1 || remaining[0].Slug != neighbor {
				t.Errorf("registry holds %v, want only the neighbor %q", remaining, neighbor)
			}
		})
	})

	t.Run("given the stack's Redis DB", func(t *testing.T) {
		t.Run("when it is destroyed, its own Redis DB is flushed so the next stack starts with no queued jobs", func(t *testing.T) {
			_, _, _, o := newOrch([]domain.Stack{
				{Slug: mine, WorktreeDir: "/repos/langwatch", RedisDB: 4},
				{Slug: neighbor, WorktreeDir: "/repos/langwatch", RedisDB: 2},
			})
			rds := &fakeRedis{}
			o.rds, o.cfg.ShouldManageRedis = rds, true
			if err := o.DestroyStack(ctx, mine); err != nil {
				t.Fatalf("DestroyStack: %v", err)
			}
			if !slices.Equal(rds.flushed, []int{4}) {
				t.Errorf("flushed %v, want only [4]", rds.flushed)
			}
		})
		t.Run("when another registered stack shares that DB, it is left alone", func(t *testing.T) {
			_, _, _, o := newOrch([]domain.Stack{
				{Slug: mine, WorktreeDir: "/repos/langwatch", RedisDB: 4},
				{Slug: neighbor, WorktreeDir: "/repos/langwatch", RedisDB: 4},
			})
			rds := &fakeRedis{}
			o.rds, o.cfg.ShouldManageRedis = rds, true
			if err := o.DestroyStack(ctx, mine); err != nil {
				t.Fatalf("DestroyStack: %v", err)
			}
			if len(rds.flushed) != 0 {
				t.Errorf("flushed %v, want nothing while %q still uses db 4", rds.flushed, neighbor)
			}
		})
	})

	t.Run("given a launcher that takes a while to exit", func(t *testing.T) {
		t.Run("when the stack is destroyed, its Redis DB is flushed only once the launcher is gone", func(t *testing.T) {
			_, _, _, o := newOrch([]domain.Stack{{Slug: mine, WorktreeDir: "/repos/langwatch", LauncherPID: 4242, RedisDB: 4}})
			sys := &lingeringLauncher{fakeSystem: &fakeSystem{alive: map[int]bool{4242: true}}, pid: 4242, polls: 3}
			rds := &fakeRedis{}
			o.sys, o.rds, o.cfg.ShouldManageRedis = sys, rds, true
			rds.onFlush = func() { sys.aliveAtFlush = sys.alive[4242] }
			if err := o.DestroyStack(ctx, mine); err != nil {
				t.Fatalf("DestroyStack: %v", err)
			}
			if !slices.Equal(rds.flushed, []int{4}) || sys.aliveAtFlush {
				t.Errorf("flushed %v with the launcher alive=%v; want [4] after it exited, or its lanes refill the DB", rds.flushed, sys.aliveAtFlush)
			}
		})
	})

	t.Run("given a slug no stack is registered under", func(t *testing.T) {
		t.Run("when it is destroyed, the databases a dead boot left behind still go", func(t *testing.T) {
			ch, pg, _, o := newOrch([]domain.Stack{{Slug: neighbor, WorktreeDir: "/repos/langwatch", LauncherPID: 99}})
			if err := o.DestroyStack(ctx, mine); err != nil {
				t.Fatalf("an unregistered slug must not be an error: %v", err)
			}
			if len(ch.dropped) != 1 || len(pg.dropped) != 1 {
				t.Errorf("dropped ch=%v pg=%v, want the slug's own database on each", ch.dropped, pg.dropped)
			}
		})
	})

	t.Run("given a slug naming the shared main database", func(t *testing.T) {
		t.Run("when it is destroyed, it is refused and nothing is dropped", func(t *testing.T) {
			ch, pg, _, o := newOrch(nil)
			if err := o.DestroyStack(ctx, "main"); err == nil {
				t.Fatal("destroying the shared main database must be refused")
			}
			if len(ch.dropped) != 0 || len(pg.dropped) != 0 {
				t.Errorf("dropped ch=%v pg=%v, want nothing", ch.dropped, pg.dropped)
			}
		})
	})

	t.Run("given a malformed slug", func(t *testing.T) {
		t.Run("when it is destroyed, it is refused before anything is resolved", func(t *testing.T) {
			_, _, _, o := newOrch(nil)
			if err := o.DestroyStack(ctx, "Not A Slug"); err == nil {
				t.Fatal("a malformed slug must be refused")
			}
		})
	})
}

// DatabaseForSlug is what makes the refusal above reachable; pin the mapping
// the guard depends on rather than trusting the two to stay in step.
func TestMainSlugNamesTheProtectedDatabase(t *testing.T) {
	if !domain.IsProtectedDatabase(domain.DatabaseForSlug("main")) {
		t.Fatal("slug \"main\" must map onto the protected shared database")
	}
}

// lingeringLauncher is a launcher that outlives SIGTERM for a few liveness
// polls, as a real one shutting its lanes down does.
type lingeringLauncher struct {
	*fakeSystem
	pid          int
	polls        int
	aliveAtFlush bool
}

func (l *lingeringLauncher) Terminate(pid int) { l.terminated = append(l.terminated, pid) }

func (l *lingeringLauncher) ProcessAlive(pid int) bool {
	if pid == l.pid && len(l.terminated) > 0 && l.alive[pid] {
		l.polls--
		l.alive[pid] = l.polls > 0
	}
	return l.alive[pid]
}
