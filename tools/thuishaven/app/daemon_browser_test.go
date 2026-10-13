package app

import (
	"strings"
	"testing"
	"time"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

const (
	testShell   = "/Users/x/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell --disable-gpu"
	testDaemon  = "node /w/apps/haven-web/scripts/browser-daemon.ts"
	testOutside = "node /other/repo/walk.mjs"
	testWalker  = "node /w/.claude/tmp/upgradelab/walk.mjs"
)

func browserOrch(sys *fakeSystem, store *fakeStore) *Orchestrator {
	return &Orchestrator{
		cfg:   Config{Browser: domain.DefaultBrowserLimits(), BrowserOwnerRoots: []string{"/w"}},
		sys:   sys,
		store: store,
		log:   zap.NewNop(),
	}
}

// browserTree is haven's daemon (100) -> shell (101) -> renderer (102), plus
// an outside script (200) -> its own shell (201), each renderer at rss.
func browserTree(rss int64, cpu101, cpu201 time.Duration) []ProcessSample {
	return agedBrowserTree(time.Hour, rss, cpu101, cpu201)
}

func agedBrowserTree(age time.Duration, rss int64, cpu101, cpu201 time.Duration) []ProcessSample {
	return []ProcessSample{
		{PID: 100, PPID: 1, PGID: 100, RSSBytes: 50 << 20, Elapsed: age, Command: testDaemon},
		{PID: 101, PPID: 100, PGID: 101, RSSBytes: 100 << 20, Elapsed: age, CPUTime: cpu101, Command: testShell},
		{PID: 102, PPID: 101, PGID: 101, RSSBytes: rss, Elapsed: age, Command: testShell + " --type=renderer"},
		{PID: 200, PPID: 1, PGID: 200, RSSBytes: 50 << 20, Elapsed: age, Command: testOutside},
		{PID: 201, PPID: 200, PGID: 201, RSSBytes: 100 << 20, Elapsed: age, CPUTime: cpu201, Command: testShell},
		{PID: 202, PPID: 201, PGID: 201, RSSBytes: rss, Elapsed: age, Command: testShell + " --type=renderer"},
	}
}

// @scenario "A headless browser above its memory ceiling is reaped whole"
func TestBrowserGovernorReapsHavensShellGroup(t *testing.T) {
	now := time.Date(2026, 10, 11, 12, 0, 0, 0, time.UTC)
	sys := &fakeSystem{now: now, procSamples: browserTree(9<<30, 0, 0)}
	store := &fakeStore{}
	o := browserOrch(sys, store)
	o.governProcesses()
	if len(sys.groupKilled) != 1 || sys.groupKilled[0] != 101 || len(sys.killed) != 0 {
		t.Fatalf("groupKilled = %v killed = %v, want only haven's shell group 101", sys.groupKilled, sys.killed)
	}
	if len(store.reapEvents) != 1 || store.reapEvents[0].Kind != "browser" ||
		!strings.Contains(store.reapEvents[0].Target, "apps/haven-web/scripts/browser-daemon.ts") {
		t.Fatalf("reap events = %+v, want one of kind browser", store.reapEvents)
	}
}

// @scenario "The browser governor only ever touches LangWatch's headless browsers"
func TestBrowserGovernorLeavesOtherShellsAlone(t *testing.T) {
	now := time.Date(2026, 10, 11, 12, 0, 0, 0, time.UTC)
	sys := &fakeSystem{now: now, procSamples: browserTree(1<<30, 0, 0)}
	sys.procSamples[5].RSSBytes = 20 << 30 // the outside shell's renderer is huge
	o := browserOrch(sys, &fakeStore{})
	o.governProcesses()
	if len(sys.groupKilled) != 0 || len(sys.killed) != 0 {
		t.Fatalf("groupKilled = %v killed = %v, want nothing", sys.groupKilled, sys.killed)
	}
}

// @scenario "A headless browser is reaped only for sustained CPU, never a spike"
func TestBrowserGovernorCPUSustainedNotSpike(t *testing.T) {
	start := time.Date(2026, 10, 11, 12, 0, 0, 0, time.UTC)
	tick := 10 * time.Second
	sys := &fakeSystem{now: start, procSamples: browserTree(1<<30, 0, 0)}
	o := browserOrch(sys, &fakeStore{})
	o.cfg.Browser.CPUSustain = 30 * time.Second
	cpu, outside := time.Duration(0), time.Duration(0)
	step := func(rate time.Duration) {
		sys.now = sys.now.Add(tick)
		cpu += rate
		outside += 4 * tick // the outside shell burns 400% throughout
		sys.procSamples = agedBrowserTree(time.Hour+sys.now.Sub(start), 1<<30, cpu, outside)
		o.governProcesses()
	}
	o.governProcesses()
	step(4 * tick) // one hot sample at 400%
	step(0)        // calm again
	step(4 * tick)
	if len(sys.groupKilled) != 0 {
		t.Fatalf("a spike reaped %v", sys.groupKilled)
	}
	step(4 * tick)
	step(4 * tick)
	if len(sys.groupKilled) != 1 || sys.groupKilled[0] != 101 {
		t.Fatalf("groupKilled = %v, want haven's shell once hot for the sustain period", sys.groupKilled)
	}
}

// @scenario "The browser governor only ever touches LangWatch's headless browsers"
func TestBrowserGovernorReapsACheckoutScriptsShellByOwner(t *testing.T) {
	now := time.Date(2026, 10, 11, 12, 0, 0, 0, time.UTC)
	samples := browserTree(1<<30, 0, 0)
	samples[3].Command = testWalker
	samples[5].RSSBytes = 9 << 30
	sys := &fakeSystem{now: now, procSamples: samples}
	store := &fakeStore{}
	browserOrch(sys, store).governProcesses()
	if len(sys.groupKilled) != 1 || sys.groupKilled[0] != 201 {
		t.Fatalf("groupKilled = %v, want the walker's shell 201", sys.groupKilled)
	}
	if len(store.reapEvents) != 1 || !strings.Contains(store.reapEvents[0].Target, ".claude/tmp/upgradelab/walk.mjs") {
		t.Fatalf("reap events = %+v, want the walker named as owner", store.reapEvents)
	}
}
