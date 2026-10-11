package app

import (
	"slices"
	"strings"
	"testing"
	"time"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

const devRuntimeLoop = "sh -c while true; do node --experimental-transform-types src/app.entrypoint.ts; code=$?; test $code -eq 75 || exit $code; done"

func orphanOrch(sys *fakeSystem, store *fakeStore) *Orchestrator {
	return &Orchestrator{
		cfg:   Config{Orphans: domain.DefaultOrphanLimits(), BrowserOwnerRoots: []string{"/w"}},
		sys:   sys,
		store: store,
		log:   zap.NewNop(),
	}
}

// orphanMachine is the live shape: an escaped restart loop (500) and its node
// child, a keeper's live lane, a young orphan, an orphan outside the checkout
// and an agent session, all parented to PID 1.
func orphanMachine() ([]ProcessSample, map[int]string) {
	samples := []ProcessSample{
		{PID: 500, PPID: 1, PGID: 500, Elapsed: 13 * time.Hour, Command: devRuntimeLoop},
		{PID: 501, PPID: 500, PGID: 500, RSSBytes: 1 << 30, Elapsed: 13 * time.Hour, Command: "node --experimental-transform-types src/app.entrypoint.ts"},
		{PID: 300, PPID: 1, PGID: 300, Elapsed: 2 * time.Hour, Command: "/Users/x/go/bin/haven keep w --agent"},
		{PID: 301, PPID: 300, PGID: 301, Elapsed: 2 * time.Hour, Command: "bash -lc pnpm --filter @langwatch/dev-runtime dev"},
		{PID: 302, PPID: 301, PGID: 302, Elapsed: 2 * time.Hour, Command: devRuntimeLoop},
		{PID: 600, PPID: 1, PGID: 600, Elapsed: 5 * time.Minute, Command: "node vite.js"},
		{PID: 700, PPID: 1, PGID: 700, Elapsed: 5 * time.Hour, Command: "node server.js"},
		{PID: 800, PPID: 1, PGID: 800, Elapsed: 5 * time.Hour, Command: "node /usr/local/bin/claude"},
	}
	cwds := map[int]string{500: "/w/tools/dev-runtime", 302: "/w/tools/dev-runtime", 600: "/w/apps/ui", 700: "/other/repo", 800: "/w"}
	return samples, cwds
}

func TestOrphanSweepTerminatesEscapedRestartLoopRootFirst(t *testing.T) {
	now := time.Date(2026, 10, 11, 12, 0, 0, 0, time.UTC)
	samples, cwds := orphanMachine()
	sys := &fakeSystem{now: now, procSamples: samples, cwds: cwds}
	store := &fakeStore{stacks: []domain.Stack{{Slug: "w", WorktreeDir: "/w", LauncherPID: 300}}}
	o := orphanOrch(sys, store)

	o.sweepRepoOrphans()

	if !slices.Equal(sys.terminated, []int{500, 501}) {
		t.Fatalf("terminated = %v, want the loop 500 then its node 501, nothing else", sys.terminated)
	}
	if len(store.reapEvents) != 1 || store.reapEvents[0].Kind != domain.OrphanClass ||
		!strings.Contains(store.reapEvents[0].Target, "/w/tools/dev-runtime") ||
		!strings.Contains(store.reapEvents[0].Reason, "PID 1") {
		t.Fatalf("reap events = %+v, want one orphans event naming the cwd", store.reapEvents)
	}
}

func TestOrphanSweepKillsWhatIgnoredTermOnALaterSweep(t *testing.T) {
	now := time.Date(2026, 10, 11, 12, 0, 0, 0, time.UTC)
	samples, cwds := orphanMachine()
	sys := &fakeSystem{now: now, procSamples: samples, cwds: cwds}
	o := orphanOrch(sys, &fakeStore{stacks: []domain.Stack{{Slug: "w", WorktreeDir: "/w", LauncherPID: 300}}})
	o.sweepRepoOrphans()

	sys.now = now.Add(20 * time.Second)
	o.sweepRepoOrphans()
	if len(sys.killed) != 0 {
		t.Fatalf("killed = %v inside the sweep cadence, want nothing", sys.killed)
	}

	sys.now = now.Add(time.Minute)
	sys.procSamples = []ProcessSample{
		{PID: 501, PPID: 1, PGID: 500, Elapsed: 13*time.Hour + time.Minute, Command: "node src/app.entrypoint.ts"},
		{PID: 500, PPID: 1, PGID: 500, Elapsed: time.Minute, Command: devRuntimeLoop}, // pid reused
	}
	o.sweepRepoOrphans()
	if !slices.Equal(sys.killed, []int{501}) {
		t.Fatalf("killed = %v, want only 501: 500 now names a new process", sys.killed)
	}
}

func TestOrphanSweepReportsATreeOnceAcrossTermAndKill(t *testing.T) {
	now := time.Date(2026, 10, 11, 12, 0, 0, 0, time.UTC)
	samples, cwds := orphanMachine()
	sys := &fakeSystem{now: now, procSamples: samples, cwds: cwds}
	store := &fakeStore{stacks: []domain.Stack{{Slug: "w", WorktreeDir: "/w", LauncherPID: 300}}}
	o := orphanOrch(sys, store)
	o.sweepRepoOrphans()

	sys.now = now.Add(time.Minute)
	for i := range samples {
		samples[i].Elapsed += time.Minute
	}
	sys.procSamples = samples
	o.sweepRepoOrphans()

	if !slices.Equal(sys.killed, []int{500, 501}) && !slices.Equal(sys.killed, []int{501, 500}) {
		t.Fatalf("killed = %v, want the termed tree", sys.killed)
	}
	if len(store.reapEvents) != 1 || !slices.Equal(sys.terminated, []int{500, 501}) {
		t.Fatalf("reap events = %d, terminated = %v, want one report and one TERM", len(store.reapEvents), sys.terminated)
	}
}

func TestOrphanSweepReapsOnlyLongTypecheckRunsInTheCheckout(t *testing.T) {
	now := time.Date(2026, 10, 11, 12, 0, 0, 0, time.UTC)
	old := 50 * time.Minute
	sys := &fakeSystem{now: now, procSamples: []ProcessSample{
		{PID: 10, PPID: 9, Elapsed: old, Command: "/w/node_modules/.bin/tsgo -b tsconfig.json"},
		{PID: 11, PPID: 9, Elapsed: old, Command: "node /w/node_modules/typescript/bin/tsc --noEmit"},
		{PID: 12, PPID: 9, Elapsed: 2 * time.Hour, Command: "tsgo --lsp --stdio"},
		{PID: 13, PPID: 9, Elapsed: 2 * time.Hour, Command: "tsgo -b --watch"},
		{PID: 14, PPID: 9, Elapsed: old, Command: "/other/node_modules/.bin/tsgo -b"},
		{PID: 15, PPID: 9, Elapsed: 10 * time.Minute, Command: "tsgo -b"},
		{PID: 300, PPID: 1, Elapsed: 3 * time.Hour, Command: "haven keep w"},
		{PID: 16, PPID: 300, Elapsed: old, Command: "tsgo -b"},
	}, cwds: map[int]string{14: "/other", 16: "/w"}}
	o := orphanOrch(sys, &fakeStore{stacks: []domain.Stack{{Slug: "w", WorktreeDir: "/w", LauncherPID: 300}}})

	o.sweepRepoOrphans()

	if !slices.Equal(sys.terminated, []int{10, 11}) {
		t.Fatalf("terminated = %v, want the two old checkout runs only", sys.terminated)
	}
}

func TestOrphanSweepDisabledByZeroLimits(t *testing.T) {
	samples, cwds := orphanMachine()
	sys := &fakeSystem{now: time.Now(), procSamples: samples, cwds: cwds}
	o := orphanOrch(sys, &fakeStore{})
	o.cfg.Orphans = domain.OrphanLimits{}
	o.sweepRepoOrphans()
	if len(sys.terminated) != 0 {
		t.Fatalf("terminated = %v with the sweep disabled", sys.terminated)
	}
}

func TestOrphanSweepCoversSiblingWorktreesOfTheRepository(t *testing.T) {
	now := time.Date(2026, 10, 11, 12, 0, 0, 0, time.UTC)
	sys := &fakeSystem{now: now, procSamples: []ProcessSample{
		{PID: 900, PPID: 1, Elapsed: time.Hour, Command: devRuntimeLoop},
	}, cwds: map[int]string{900: "/src/langwatch-sibling/tools/dev-runtime"}}
	o := orphanOrch(sys, &fakeStore{})
	o.cfg.RepoRoot = "/w"
	o.hyg = &fakeHygiene{worktrees: []Worktree{{Dir: "/w"}, {Dir: "/src/langwatch-sibling"}}}

	o.sweepRepoOrphans()

	if !slices.Equal(sys.terminated, []int{900}) {
		t.Fatalf("terminated = %v, want the loop in the sibling worktree", sys.terminated)
	}
}

func TestHubMarksWorktreeIdleFromItsLastCommit(t *testing.T) {
	now := time.Date(2026, 10, 11, 12, 0, 0, 0, time.UTC)
	hyg := &fakeHygiene{
		worktrees:    []Worktree{{Dir: "/w"}, {Dir: "/w/.worktrees/old", Branch: "feat/old"}},
		lastActivity: map[string]time.Time{"/w/.worktrees/old": now.Add(-20 * 24 * time.Hour)},
	}
	o := &Orchestrator{sys: &fakeSystem{now: now}, store: &fakeStore{}, hyg: hyg, log: zap.NewNop()}

	rows := o.hubWorktrees("/w", "/w", nil)

	if len(rows) != 2 || rows[1].IdleFor < domain.StaleWorktreeAge || rows[0].IdleFor != 0 {
		t.Fatalf("rows = %+v, want the old worktree idle past the stale age", rows)
	}
}
