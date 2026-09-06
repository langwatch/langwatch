package app

import (
	"context"
	"slices"
	"strings"
	"sync"
	"testing"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// @scenario "Deleting the ticked worktrees"
func TestDestroyWorktrees(t *testing.T) {
	primary := "/repos/langwatch"
	a := "/repos/worktrees/feat-a"
	b := "/repos/worktrees/feat-b"
	c := "/repos/worktrees/feat-c"
	ctx := context.Background()

	newOrch := func() (*fakeDBServer, *fakeDBServer, *fakeHygiene, *Orchestrator) {
		store := &fakeStore{slugCache: map[string]string{a: "feat-a", b: "feat-b", c: "feat-c"}}
		ch := &fakeDBServer{databases: []string{"lw_feat_a", "lw_feat_b", "lw_feat_c", "lw_main"}}
		pg := &fakeDBServer{databases: []string{"lw_feat_a", "lw_feat_b", "lw_feat_c", "lw_main"}}
		hyg := &fakeHygiene{worktrees: []Worktree{{Dir: primary}, {Dir: a}, {Dir: b}, {Dir: c}}}
		return ch, pg, hyg, pruneOrch(store, &fakeSystem{alive: map[int]bool{}}, ch, pg, hyg)
	}

	// collect gathers the per-dir results as the concurrent workers report them.
	collect := func() (func(string, error), func() map[string]error) {
		var mu sync.Mutex
		got := map[string]error{}
		return func(dir string, err error) {
				mu.Lock()
				got[dir] = err
				mu.Unlock()
			}, func() map[string]error {
				mu.Lock()
				defer mu.Unlock()
				out := map[string]error{}
				for k, v := range got {
					out[k] = v
				}
				return out
			}
	}

	t.Run("given three deletable worktrees", func(t *testing.T) {
		t.Run("when destroyed in bulk, each is stopped, its databases dropped, its tree removed, and git pruned once", func(t *testing.T) {
			ch, pg, hyg, o := newOrch()
			onDone, results := collect()
			o.DestroyWorktrees(ctx, primary, []string{a, b, c}, primary, onDone)

			res := results()
			if len(res) != 3 {
				t.Fatalf("expected a result per dir, got %v", res)
			}
			for _, dir := range []string{a, b, c} {
				if res[dir] != nil {
					t.Errorf("%s should have been destroyed, got %v", dir, res[dir])
				}
			}
			if len(ch.dropped) != 3 || len(pg.dropped) != 3 {
				t.Errorf("each worktree's database should be dropped once, got ch=%v pg=%v", ch.dropped, pg.dropped)
			}
			if len(hyg.removed) != 3 {
				t.Errorf("each worktree tree should be removed, got %v", hyg.removed)
			}
			if hyg.pruned != 1 {
				t.Errorf("git worktree admin should be pruned exactly once for the whole batch, got %d", hyg.pruned)
			}
		})
	})

	t.Run("given the primary checkout is among the targets", func(t *testing.T) {
		t.Run("when destroyed in bulk, it is refused and the rest still go", func(t *testing.T) {
			_, _, hyg, o := newOrch()
			onDone, results := collect()
			o.DestroyWorktrees(ctx, primary, []string{primary, a}, primary, onDone)

			res := results()
			if res[primary] == nil || !strings.Contains(res[primary].Error(), "primary") {
				t.Errorf("primary checkout should be refused, got %v", res[primary])
			}
			if res[a] != nil {
				t.Errorf("the linked worktree should still be destroyed, got %v", res[a])
			}
			if slices.Contains(hyg.removed, canonicalPath(primary)) {
				t.Error("the primary checkout must never be removed")
			}
		})
	})

	t.Run("given the launch worktree is among the targets", func(t *testing.T) {
		t.Run("when destroyed in bulk, it is refused", func(t *testing.T) {
			_, _, _, o := newOrch()
			onDone, results := collect()
			o.DestroyWorktrees(ctx, primary, []string{b}, b, onDone) // selfDir == b
			if err := results()[b]; err == nil || !strings.Contains(err.Error(), "running from") {
				t.Errorf("the launch worktree should be refused, got %v", err)
			}
		})
	})

	t.Run("given a live stack among the targets", func(t *testing.T) {
		t.Run("when destroyed in bulk, its launcher is stopped and its database dropped", func(t *testing.T) {
			store := &fakeStore{
				slugCache: map[string]string{a: "feat-a"},
				stacks:    []domain.Stack{{Slug: "feat-a", WorktreeDir: a, LauncherPID: 7}},
			}
			sys := &fakeSystem{alive: map[int]bool{7: true}}
			ch := &fakeDBServer{databases: []string{"lw_feat_a", "lw_main"}}
			pg := &fakeDBServer{databases: []string{"lw_feat_a", "lw_main"}}
			hyg := &fakeHygiene{worktrees: []Worktree{{Dir: primary}, {Dir: a}}}
			o := pruneOrch(store, sys, ch, pg, hyg)

			onDone, results := collect()
			o.DestroyWorktrees(ctx, primary, []string{a}, primary, onDone)

			if results()[a] != nil {
				t.Fatalf("live worktree should be destroyed, got %v", results()[a])
			}
			if len(sys.terminated) != 1 || sys.terminated[0] != 7 {
				t.Errorf("the live launcher should be terminated, got %v", sys.terminated)
			}
			if len(ch.dropped) != 1 || ch.dropped[0] != "lw_feat_a" {
				t.Errorf("the live worktree's database should be dropped, got %v", ch.dropped)
			}
		})
	})
}
