package app

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// --- PlanPrune: identity + guards --------------------------------------------

// @scenario "The primary checkout and the current worktree can never be deleted"
func TestPlanPrune(t *testing.T) {
	primary := "/repos/langwatch"
	current := "/repos/worktrees/current"
	liveDir := "/repos/worktrees/feat-live"
	idleDir := "/repos/worktrees/feat-idle"

	store := &fakeStore{
		stacks:    []domain.Stack{{Slug: "feat-live", WorktreeDir: liveDir, LauncherPID: 42}},
		slugCache: map[string]string{idleDir: "feat-idle"},
	}
	sys := &fakeSystem{alive: map[int]bool{42: true}}
	hyg := &fakeHygiene{worktrees: []Worktree{
		{Dir: primary}, {Dir: current}, {Dir: liveDir}, {Dir: idleDir},
	}}
	o := pruneOrch(store, sys, &fakeDBServer{}, &fakeDBServer{}, hyg)

	t.Run("given the repo's worktrees, some live", func(t *testing.T) {
		rows, err := o.PlanPrune(primary, current)
		if err != nil {
			t.Fatalf("PlanPrune: %v", err)
		}
		if len(rows) != 4 {
			t.Fatalf("expected 4 rows, got %d", len(rows))
		}

		t.Run("when planned, the primary checkout is protected", func(t *testing.T) {
			if !rows[0].IsPrimary || rows[0].Deletable() {
				t.Errorf("primary checkout must be non-deletable, got %+v", rows[0])
			}
		})
		t.Run("when planned, the current worktree is protected", func(t *testing.T) {
			if !rows[1].IsCurrent || rows[1].Deletable() {
				t.Errorf("current worktree must be non-deletable, got %+v", rows[1])
			}
		})
		t.Run("when planned, a running worktree is live, deletable, and carries its registry slug", func(t *testing.T) {
			if !rows[2].IsLive || !rows[2].Deletable() || rows[2].Slug != "feat-live" {
				t.Errorf("live worktree wrong: %+v", rows[2])
			}
		})
		t.Run("when planned, an idle worktree is deletable and carries its cached slug", func(t *testing.T) {
			if rows[3].IsLive || !rows[3].Deletable() || rows[3].Slug != "feat-idle" {
				t.Errorf("idle worktree wrong: %+v", rows[3])
			}
		})
	})
}

// --- ScanWorktrees: concurrent footprint detection ---------------------------

// @scenario "A worktree reports the resources deleting it would reclaim"
func TestScanWorktrees(t *testing.T) {
	now := time.Date(2026, 7, 21, 12, 0, 0, 0, time.UTC)
	a := "/repos/worktrees/feat-a" // has CH+PG db, idle 10d, clean
	b := "/repos/worktrees/feat-b" // has PG db only, idle 1d, dirty
	c := "/repos/worktrees/feat-c" // no slug -> no db, unknown activity

	rows := []PruneRow{
		{Dir: a, Slug: "feat-a"},
		{Dir: b, Slug: "feat-b"},
		{Dir: c, Slug: ""},
	}
	hyg := &fakeHygiene{
		dirSizes:  map[string]int64{a: 1000, b: 2000, c: 3000},
		dirtyDirs: map[string]bool{b: true},
		lastActivity: map[string]time.Time{
			a: now.Add(-10 * 24 * time.Hour),
			b: now.Add(-1 * 24 * time.Hour),
			// c: deliberately absent — activity unknown
		},
	}
	ch := &fakeDBServer{databases: []string{"lw_feat_a", "lw_main"}}
	pg := &fakeDBServer{databases: []string{"lw_feat_a", "lw_feat_b"}}
	o := pruneOrch(&fakeStore{}, &fakeSystem{now: now}, ch, pg, hyg)

	var mu sync.Mutex
	metas := map[int]PruneMeta{}
	sizes := map[int]int64{}
	o.ScanWorktrees(context.Background(), rows,
		func(i int, m PruneMeta) { mu.Lock(); metas[i] = m; mu.Unlock() },
		func(i int, b int64) { mu.Lock(); sizes[i] = b; mu.Unlock() },
	)

	t.Run("given three worktrees scanned concurrently in two queues", func(t *testing.T) {
		t.Run("when the scan completes, every row's meta and size land exactly once", func(t *testing.T) {
			if len(metas) != 3 {
				t.Errorf("expected all 3 metas, got %d", len(metas))
			}
			if len(sizes) != 3 {
				t.Errorf("expected all 3 sizes, got %d", len(sizes))
			}
		})
		t.Run("when a worktree owns databases on both servers, they are reported reclaimable", func(t *testing.T) {
			m := metas[0]
			if sizes[0] != 1000 || !m.HasCHDB || !m.HasPGDB {
				t.Errorf("feat-a should report disk + both dbs, got size=%d meta=%+v", sizes[0], m)
			}
			if m.RedisDB != domain.RedisDBForSlug("feat-a") {
				t.Errorf("feat-a redis db index wrong, got %d", m.RedisDB)
			}
			if m.StaleFor < 9*24*time.Hour || m.StaleFor > 11*24*time.Hour {
				t.Errorf("feat-a should read ~10d idle, got %s", m.StaleFor)
			}
		})
		t.Run("when a worktree owns a database on only one server, only that one is reported", func(t *testing.T) {
			m := metas[1]
			if m.HasCHDB {
				t.Errorf("feat-b has no clickhouse db, got HasCHDB=true")
			}
			if !m.HasPGDB {
				t.Errorf("feat-b should report its postgres db")
			}
			if !m.IsDirty {
				t.Errorf("feat-b should be reported dirty")
			}
		})
		t.Run("when a worktree has no slug, no database is guessed at", func(t *testing.T) {
			m := metas[2]
			if m.HasCHDB || m.HasPGDB || m.RedisDB != -1 {
				t.Errorf("feat-c has no slug — no db or redis index, got %+v", m)
			}
			if !m.LastActive.IsZero() || m.StaleFor != 0 {
				t.Errorf("feat-c activity is unknown, got %+v", m)
			}
		})
	})
}

// barrierHygiene blocks inside DiskUsage (the size queue) until every scan
// goroutine has entered it, so a serial size pass would deadlock and a concurrent
// one sails through — proving the queue really runs in parallel goroutines.
type barrierHygiene struct {
	*fakeHygiene
	onDiskUsage func()
}

func (b *barrierHygiene) DiskUsage(string) (int64, bool) {
	if b.onDiskUsage != nil {
		b.onDiskUsage()
	}
	return 0, true
}

// @scenario "Every worktree is scanned concurrently for its footprint"
func TestScanWorktreesRunsConcurrently(t *testing.T) {
	n := sizeScanSlots() // as many as the size queue runs at once
	entered := make(chan struct{}, n)
	release := make(chan struct{})
	hyg := &barrierHygiene{
		fakeHygiene: &fakeHygiene{},
		onDiskUsage: func() {
			entered <- struct{}{}
			<-release
		},
	}
	rows := make([]PruneRow, n)
	for i := range rows {
		rows[i] = PruneRow{Dir: fmt.Sprintf("/repos/worktrees/wt-%d", i)}
	}
	o := pruneOrch(&fakeStore{}, &fakeSystem{now: now2020()}, &fakeDBServer{}, &fakeDBServer{}, hyg)

	var sized int
	var mu sync.Mutex
	done := make(chan struct{})
	go func() {
		o.ScanWorktrees(context.Background(), rows, nil, func(int, int64) {
			mu.Lock()
			sized++
			mu.Unlock()
		})
		close(done)
	}()

	t.Run("given more worktrees than a single size pass can serialise", func(t *testing.T) {
		t.Run("when scanned, all of them run at once", func(t *testing.T) {
			for i := range n {
				select {
				case <-entered:
				case <-time.After(3 * time.Second):
					t.Fatalf("only %d/%d size scans ran concurrently — expected parallel goroutines", i, n)
				}
			}
			close(release)
			select {
			case <-done:
				mu.Lock()
				got := sized
				mu.Unlock()
				if got != n {
					t.Fatalf("expected %d sizes emitted, got %d", n, got)
				}
			case <-time.After(3 * time.Second):
				t.Fatal("ScanWorktrees did not finish after releasing the barrier")
			}
		})
	})
}

func now2020() time.Time { return time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC) }

// --- DefaultSelected: the pre-tick rule --------------------------------------

// @scenario "Worktrees idle for five days or more are pre-selected"
// @scenario "A recently-touched worktree is left unselected"
// @scenario "A live or dirty worktree is never pre-selected"
func TestDefaultSelected(t *testing.T) {
	now := time.Date(2026, 7, 21, 12, 0, 0, 0, time.UTC)
	stale := PruneMeta{LastActive: now.Add(-6 * 24 * time.Hour), StaleFor: 6 * 24 * time.Hour}
	fresh := PruneMeta{LastActive: now.Add(-1 * 24 * time.Hour), StaleFor: 1 * 24 * time.Hour}
	deletable := PruneRow{Dir: "/wt/x"}

	cases := []struct {
		name string
		row  PruneRow
		meta PruneMeta
		want bool
	}{
		{"stale, clean, idle worktree is pre-selected", deletable, stale, true},
		{"recently-touched worktree is not", deletable, fresh, false},
		{"live worktree is never pre-selected", PruneRow{Dir: "/wt/x", IsLive: true}, stale, false},
		{"dirty worktree is never pre-selected", deletable, PruneMeta{LastActive: stale.LastActive, StaleFor: stale.StaleFor, IsDirty: true}, false},
		{"primary checkout is never pre-selected", PruneRow{Dir: "/wt/x", IsPrimary: true}, stale, false},
		{"current worktree is never pre-selected", PruneRow{Dir: "/wt/x", IsCurrent: true}, stale, false},
		{"unknown activity is never pre-selected", deletable, PruneMeta{}, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := DefaultSelected(tc.row, tc.meta, DefaultStaleThreshold); got != tc.want {
				t.Errorf("DefaultSelected = %v, want %v", got, tc.want)
			}
		})
	}
}
