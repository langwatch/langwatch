package app

import (
	"context"
	"testing"
	"time"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// reclaimFixture is the shared shape every classification case takes: a repo
// whose first worktree is the primary checkout, plus one worktree under test.
// The primary is always present because `git worktree list` always emits it
// first and PlanPrune's primary-guard depends on that ordering.
type reclaimFixture struct {
	dir    string
	branch string
	dirty  bool
	merged bool
	live   bool
	// lastSeen is HEAD's committer date — what the idle column shows. touched is
	// the directory's own mtime, which is the clock the temporary rule reads;
	// zero means "the same as lastSeen".
	lastSeen time.Time
	touched  time.Time
}

const reclaimRepoRoot = "/repos/langwatch"

func touchedOr(f reclaimFixture) time.Time {
	if f.touched.IsZero() {
		return f.lastSeen
	}
	return f.touched
}

func reclaimOrch(now time.Time, f reclaimFixture) *Orchestrator {
	hyg := &fakeHygiene{
		worktrees:    []Worktree{{Dir: reclaimRepoRoot, Branch: "main"}, {Dir: f.dir, Branch: f.branch}},
		dirtyDirs:    map[string]bool{f.dir: f.dirty},
		mergedDirs:   map[string]bool{f.dir: f.merged},
		lastActivity: map[string]time.Time{reclaimRepoRoot: now, f.dir: f.lastSeen},
		lastTouched:  map[string]time.Time{reclaimRepoRoot: now, f.dir: touchedOr(f)},
	}
	store := &fakeStore{}
	sys := &fakeSystem{now: now, alive: map[int]bool{}}
	if f.live {
		store.stacks = []domain.Stack{{Slug: "live", WorktreeDir: f.dir, LauncherPID: 77}}
		sys.alive[77] = true
	}
	o := pruneOrch(store, sys, &fakeDBServer{}, &fakeDBServer{}, hyg)
	o.cfg.RepoRoot = reclaimRepoRoot
	return o
}

// @scenario "A temporary worktree left by a diff tool is reclaimed after a day"
// @scenario "A worktree on an agent-minted branch is reclaimed after a day"
// @scenario "A temporary worktree touched this morning is left alone"
// @scenario "A diff drive is judged by its directory, not by the ref it checked out"
// @scenario "A worktree whose branch is already on main is reclaimed"
// @scenario "A worktree with uncommitted changes is never reclaimed, whatever its age"
// @scenario "A worktree with a stack running from it is never reclaimed"
func TestClassifyingWorktreesForReclaim(t *testing.T) {
	now := time.Date(2026, 9, 7, 12, 0, 0, 0, time.UTC)
	old := now.Add(-30 * 24 * time.Hour)
	yesterday := now.Add(-48 * time.Hour)
	recent := now.Add(-time.Hour)

	cases := []struct {
		name    string
		fixture reclaimFixture
		want    domain.WorktreeClass
	}{
		{
			name:    "given a detached worktree the apidiff tool left behind",
			fixture: reclaimFixture{dir: reclaimRepoRoot + "/.apidiff/base", lastSeen: yesterday},
			want:    domain.ClassTemporary,
		},
		{
			name:    "given a detached worktree under .claude/worktrees",
			fixture: reclaimFixture{dir: reclaimRepoRoot + "/.claude/worktrees/lane-a", lastSeen: yesterday},
			want:    domain.ClassTemporary,
		},
		{
			name:    "given a visual-diff drive beside the checkout",
			fixture: reclaimFixture{dir: "/repos/worktrees/visual-7601", lastSeen: yesterday},
			want:    domain.ClassTemporary,
		},
		{
			name:    "given an apidiff drive the tool put in the system temp dir",
			fixture: reclaimFixture{dir: "/private/tmp/apidiff-4c41001475-candidate", lastSeen: yesterday},
			want:    domain.ClassTemporary,
		},
		{
			name:    "given a visual-diff pair checked out inside a job's own scratch",
			fixture: reclaimFixture{dir: "/Users/dev/.claude/jobs/ab12/tmp/visual/vd3/base", lastSeen: yesterday},
			want:    domain.ClassTemporary,
		},
		{
			// The regression this guards: LastActivity reads HEAD's committer date,
			// and a diff drive checks out whatever ref it is comparing — so a
			// minutes-old comparison of a year-old tag reads as a year idle. The
			// temporary clock is the directory's own mtime for exactly this reason.
			name: "given a diff drive created minutes ago at a year-old ref",
			fixture: reclaimFixture{
				dir:      "/private/tmp/apidiff-99-base",
				lastSeen: now.Add(-365 * 24 * time.Hour),
				touched:  now.Add(-5 * time.Minute),
			},
			want: domain.ClassNone,
		},
		{
			name:    "given an agent worktree on a real feature branch",
			fixture: reclaimFixture{dir: reclaimRepoRoot + "/.codex/worktrees/identity", branch: "feat/identity", lastSeen: old},
			want:    domain.ClassNone,
		},
		{
			name:    "given a worktree on an agent-minted branch",
			fixture: reclaimFixture{dir: "/repos/worktrees/lane", branch: "worktree-agent-4f2", lastSeen: yesterday},
			want:    domain.ClassTemporary,
		},
		{
			name:    "given a worktree on an agent/ branch",
			fixture: reclaimFixture{dir: "/repos/worktrees/lane", branch: "agent/sweep", lastSeen: yesterday},
			want:    domain.ClassTemporary,
		},
		{
			name:    "given a temporary worktree touched an hour ago",
			fixture: reclaimFixture{dir: reclaimRepoRoot + "/.claude/worktrees/lane-b", lastSeen: recent},
			want:    domain.ClassNone,
		},
		{
			name:    "given a worktree whose branch is an ancestor of origin/main",
			fixture: reclaimFixture{dir: "/repos/worktrees/feat-done", branch: "feat/done", merged: true, lastSeen: recent},
			want:    domain.ClassMerged,
		},
		{
			name:    "given a month-old temporary worktree holding uncommitted changes",
			fixture: reclaimFixture{dir: reclaimRepoRoot + "/.apidiff/head", dirty: true, lastSeen: old},
			want:    domain.ClassNone,
		},
		{
			name:    "given a merged worktree holding uncommitted changes",
			fixture: reclaimFixture{dir: "/repos/worktrees/feat-dirty", branch: "feat/dirty", merged: true, dirty: true, lastSeen: old},
			want:    domain.ClassNone,
		},
		{
			name:    "given a merged worktree with a live stack running from it",
			fixture: reclaimFixture{dir: "/repos/worktrees/feat-live", branch: "feat/live", merged: true, live: true, lastSeen: old},
			want:    domain.ClassNone,
		},
		{
			name:    "given an ordinary unmerged worktree idle for a month",
			fixture: reclaimFixture{dir: "/repos/worktrees/feat-idle", branch: "feat/idle", lastSeen: old},
			want:    domain.ClassNone,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			o := reclaimOrch(now, tc.fixture)

			t.Run("when haven classifies the worktrees", func(t *testing.T) {
				got, err := o.PlanReclaimableWorktrees(context.Background(), reclaimRepoRoot, reclaimRepoRoot)
				if err != nil {
					t.Fatalf("PlanReclaimableWorktrees: %v", err)
				}
				if tc.want == domain.ClassNone {
					if len(got) != 0 {
						t.Fatalf("expected nothing offered for reclaim, got %+v", got)
					}
					return
				}
				if len(got) != 1 {
					t.Fatalf("expected exactly the worktree under test, got %+v", got)
				}
				if got[0].Class != tc.want {
					t.Errorf("class = %q, want %q", got[0].Class, tc.want)
				}
				if got[0].Reason == "" {
					t.Error("a reclaimable worktree must carry the reason shown to the operator")
				}
			})
		})
	}
}

// @scenario "The primary checkout is never reclaimed automatically"
func TestThePrimaryCheckoutIsNeverReclaimed(t *testing.T) {
	now := time.Date(2026, 9, 7, 12, 0, 0, 0, time.UTC)

	t.Run("given the primary checkout, on a branch already contained in main", func(t *testing.T) {
		hyg := &fakeHygiene{
			worktrees:    []Worktree{{Dir: reclaimRepoRoot, Branch: "main"}},
			mergedDirs:   map[string]bool{reclaimRepoRoot: true},
			lastActivity: map[string]time.Time{reclaimRepoRoot: now.Add(-90 * 24 * time.Hour)},
		}
		o := pruneOrch(&fakeStore{}, &fakeSystem{now: now}, &fakeDBServer{}, &fakeDBServer{}, hyg)

		t.Run("when haven classifies the worktrees, it is not offered", func(t *testing.T) {
			got, err := o.PlanReclaimableWorktrees(context.Background(), reclaimRepoRoot, reclaimRepoRoot)
			if err != nil {
				t.Fatalf("PlanReclaimableWorktrees: %v", err)
			}
			if len(got) != 0 {
				t.Fatalf("the primary checkout must never be a candidate, got %+v", got)
			}
		})
	})
}

// @scenario "The daemon removes the classified worktrees and leaves their databases"
func TestTheDaemonReclaimsClassifiedWorktrees(t *testing.T) {
	now := time.Date(2026, 9, 7, 12, 0, 0, 0, time.UTC)
	temporary := reclaimRepoRoot + "/.claude/worktrees/lane-a"
	merged := "/repos/worktrees/feat-done"
	keep := "/repos/worktrees/feat-wip"

	hyg := &fakeHygiene{
		worktrees: []Worktree{
			{Dir: reclaimRepoRoot, Branch: "main"},
			{Dir: temporary},
			{Dir: merged, Branch: "feat/done"},
			{Dir: keep, Branch: "feat/wip"},
		},
		mergedDirs: map[string]bool{merged: true},
		lastActivity: map[string]time.Time{
			reclaimRepoRoot: now,
			temporary:       now.Add(-48 * time.Hour),
			merged:          now.Add(-time.Hour),
			keep:            now.Add(-30 * 24 * time.Hour),
		},
	}
	// Both worktrees own a database on each server. The daemon must leave them
	// where they are: a database is not regenerable, so only the interactive
	// picker may drop one (ADR-064).
	ch := &fakeDBServer{databases: []string{"lw_lane_a", "lw_feat_done"}}
	pg := &fakeDBServer{databases: []string{"lw_lane_a", "lw_feat_done"}}
	o := pruneOrch(&fakeStore{}, &fakeSystem{now: now}, ch, pg, hyg)
	o.cfg.RepoRoot = reclaimRepoRoot
	o.log = zap.NewNop()

	t.Run("given a temporary worktree, a merged one, and an ordinary idle one", func(t *testing.T) {
		t.Run("when the daemon runs its daily disk reclaim", func(t *testing.T) {
			o.reapReclaimableWorktrees(context.Background())

			t.Run("both classified worktrees are removed and the idle one is left", func(t *testing.T) {
				got := hyg.removedWorktrees
				if len(got) != 2 {
					t.Fatalf("expected exactly the two classified worktrees removed, got %v", got)
				}
				for _, want := range []string{temporary, merged} {
					if !containsString(got, want) {
						t.Errorf("%s should have been removed, got %v", want, got)
					}
				}
				if containsString(got, keep) {
					t.Errorf("an ordinary idle worktree must not be removed unattended, got %v", got)
				}
			})

			t.Run("each removal is recorded with the reason that justified it", func(t *testing.T) {
				events := o.store.ReapEvents()
				if len(events) != 2 {
					t.Fatalf("expected one recorded reap per removal, got %+v", events)
				}
				for _, ev := range events {
					if ev.Kind != "worktree" || ev.Reason == "" {
						t.Errorf("a reap must name its kind and reason, got %+v", ev)
					}
				}
			})

			t.Run("no database is dropped on the unattended path", func(t *testing.T) {
				if len(ch.dropped) != 0 || len(pg.dropped) != 0 {
					t.Errorf("databases are not regenerable and must survive the daemon: ch=%v pg=%v", ch.dropped, pg.dropped)
				}
			})
		})
	})
}

func containsString(all []string, want string) bool {
	for _, s := range all {
		if s == want {
			return true
		}
	}
	return false
}
