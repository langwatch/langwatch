package domain

import (
	"testing"
	"time"
)

// Command lines taken from a live `ps -axo command` on a dev machine.
const (
	livePlaywrightShell = "/Users/lw/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell --disable-field-trial-config --disable-background-networking"
	liveRenderer        = "/Users/lw/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell --type=renderer --headless=old --no-sandbox"
	liveHavenDaemon     = "node /Users/lw/Source/github.com/langwatch/langwatch/apps/haven-web/scripts/browser-daemon.ts"
	liveUpgradeWalk     = "node /Users/lw/Source/github.com/langwatch/langwatch/.claude/tmp/upgradelab/cells/t5-b/walk.mjs {\"every\":10000}"
	livePlaywrightMCP   = "node /Users/lw/.npm/_npx/9833c18b2d85bc59/node_modules/@playwright/mcp/cli.js --headless"
)

// @scenario "The browser governor only ever touches LangWatch's headless browsers"
func TestHeadlessShellOwner(t *testing.T) {
	roots := []string{"/Users/lw/Source/github.com/langwatch/langwatch"}
	cases := []struct {
		name, command, parent, owner string
		want                         bool
	}{
		{"haven's shell under haven's daemon", livePlaywrightShell, liveHavenDaemon, "apps/haven-web/scripts/browser-daemon.ts", true},
		{"an upgradelab walker's shell", livePlaywrightShell, liveUpgradeWalk, ".claude/tmp/upgradelab/cells/t5-b/walk.mjs", true},
		{"a worktree script's shell", livePlaywrightShell, "node /Users/lw/Source/github.com/langwatch/langwatch/.worktrees/feat-x/dev/tests/run.mjs", ".worktrees/feat-x/dev/tests/run.mjs", true},
		{"older headless_shell name", "/cache/ms-playwright/chromium-1100/chrome-linux/headless_shell --headless", liveHavenDaemon, "apps/haven-web/scripts/browser-daemon.ts", true},
		{"haven's daemon from a checkout outside the roots", livePlaywrightShell, "node /elsewhere/lw/apps/haven-web/scripts/browser-daemon.ts", HavenBrowserDaemonOwner, true},
		{"renderer under the shell", liveRenderer, livePlaywrightShell, "", false},
		{"Playwright MCP's shell", livePlaywrightShell, livePlaywrightMCP, "", false},
		{"an unrelated repo's script", livePlaywrightShell, "node /Users/lw/Source/github.com/other/repo/e2e.mjs", "", false},
		{"a sibling path sharing the root's prefix", livePlaywrightShell, "node /Users/lw/Source/github.com/langwatch/langwatch-old/walk.mjs", "", false},
		{"a shell outside the Playwright cache", "/opt/chrome-headless-shell/chrome-headless-shell --headless", liveUpgradeWalk, "", false},
		{"the person's Chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/sbin/launchd", "", false},
		{"an Electron helper", "/Applications/Slack.app/Contents/Frameworks/Slack Helper (Renderer).app/Contents/MacOS/Slack Helper (Renderer) --type=renderer", "/Applications/Slack.app/Contents/MacOS/Slack", "", false},
		{"Chromium under haven's daemon", "/Applications/Chromium.app/Contents/MacOS/Chromium --headless", liveHavenDaemon, "", false},
		{"shell name only in an argument", "/bin/cat /x/ms-playwright/chrome-headless-shell", liveHavenDaemon, "", false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			owner, ok := HeadlessShellOwner(c.command, c.parent, roots)
			if ok != c.want || owner != c.owner {
				t.Fatalf("HeadlessShellOwner = %q, %v; want %q, %v", owner, ok, c.owner, c.want)
			}
		})
	}
}

// @scenario "A headless browser above its memory ceiling is reaped whole"
func TestGovernBrowserMemoryCeiling(t *testing.T) {
	now := time.Date(2026, 10, 11, 12, 0, 0, 0, time.UTC)
	l := DefaultBrowserLimits()
	shells := []BrowserShell{
		{PID: 1, RSS: 9 << 30, Started: now.Add(-time.Hour)},
		{PID: 2, RSS: 1 << 30, Started: now.Add(-time.Hour)},
	}
	kills := GovernBrowser(shells, l, now)
	if len(kills) != 1 || kills[0].PID != 1 || kills[0].Reason != "headless browser exceeds its memory ceiling" {
		t.Fatalf("kills = %+v, want only the 9 GiB shell", kills)
	}
	l.MaxRSS = 0
	if kills := GovernBrowser(shells, l, now); kills != nil {
		t.Fatalf("a zero memory ceiling disables the governor, got %+v", kills)
	}
}

// @scenario "A headless browser is reaped only for sustained CPU, never a spike"
func TestGovernBrowserSustainedCPU(t *testing.T) {
	now := time.Date(2026, 10, 11, 12, 0, 0, 0, time.UTC)
	l := DefaultBrowserLimits()
	spike := BrowserShell{PID: 1, RSS: 1 << 30, Started: now.Add(-time.Hour), HotFor: 10 * time.Second}
	sustained := BrowserShell{PID: 2, RSS: 1 << 30, Started: now.Add(-time.Hour), HotFor: l.CPUSustain}
	kills := GovernBrowser([]BrowserShell{spike, sustained}, l, now)
	if len(kills) != 1 || kills[0].PID != 2 {
		t.Fatalf("kills = %+v, want only the sustained shell", kills)
	}
}

// @scenario "An idle headless browser past its maximum age is reaped"
func TestGovernBrowserIdleMaxAge(t *testing.T) {
	now := time.Date(2026, 10, 11, 12, 0, 0, 0, time.UTC)
	l := DefaultBrowserLimits()
	old := now.Add(-7 * time.Hour)
	idle := BrowserShell{PID: 1, RSS: 1 << 30, Started: old, IdleFor: l.IdleTTL}
	working := BrowserShell{PID: 2, RSS: 1 << 30, Started: old}
	young := BrowserShell{PID: 3, RSS: 1 << 30, Started: now.Add(-time.Hour), IdleFor: time.Hour}
	kills := GovernBrowser([]BrowserShell{idle, working, young}, l, now)
	if len(kills) != 1 || kills[0].PID != 1 {
		t.Fatalf("kills = %+v, want only the old idle shell", kills)
	}
}

// @scenario "A headless browser above its memory ceiling is reaped whole"
func TestBrowserMemoryLimitFollowsTheMachine(t *testing.T) {
	cases := []struct {
		ramGiB  uint64
		limitMB int
		killMB  int64
	}{
		{8, 2048, 3072},
		{16, 2048, 3072},
		{32, 4096, 5120},
		{64, 8192, 10240},
		{128, 8192, 10240},
	}
	for _, c := range cases {
		limit := DefaultBrowserMemoryMB(c.ramGiB << 30)
		if limit != c.limitMB {
			t.Errorf("%d GiB: limit %d MB, want %d", c.ramGiB, limit, c.limitMB)
		}
		if kill := BrowserKillRSS(limit) >> 20; kill != c.killMB {
			t.Errorf("%d GiB: governor kills above %d MB, want %d", c.ramGiB, kill, c.killMB)
		}
	}
}

// @scenario "A headless browser above its memory ceiling is reaped whole"
// @scenario "The shared browser between its memory limit and the headroom is not reaped"
func TestGovernorSparesABrowserBetweenLimitAndHeadroom(t *testing.T) {
	now := time.Date(2026, 10, 11, 12, 0, 0, 0, time.UTC)
	limitMB := 8192
	l := DefaultBrowserLimits()
	l.MaxRSS = BrowserKillRSS(limitMB)
	refusing := BrowserShell{PID: 1, RSS: int64(limitMB+512) << 20, Started: now.Add(-time.Hour)}
	runaway := BrowserShell{PID: 2, RSS: l.MaxRSS + 1, Started: now.Add(-time.Hour)}
	kills := GovernBrowser([]BrowserShell{refusing, runaway}, l, now)
	if len(kills) != 1 || kills[0].PID != 2 {
		t.Fatalf("kills = %+v, want only the shell past the headroom", kills)
	}
}
