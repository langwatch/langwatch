package domain

import (
	"slices"
	"strings"
	"time"
)

// The headless browser governor: the second class ADR-095's watchdog carries
// kill limits for. Playwright headless shells started from a LangWatch checkout
// (haven browser, upgradelab walkers, e2e) can climb to cores and gigabytes
// after hours. Decisions here are pure; the daemon samples,
// tracks CPU across ticks and enforces. See specs/setup/haven-tsgo-governor.feature.

// HeadlessBrowserClass is the reap Kind and procmetrics class of a reaped shell.
const HeadlessBrowserClass = "browser"

// headlessShellBinaries are the names Playwright's headless shell runs under:
// `chrome-headless-shell` in current builds, `headless_shell` in older ones.
var headlessShellBinaries = []string{"chrome-headless-shell", "headless_shell"}

// playwrightCacheSegment marks a binary installed in Playwright's browser cache.
const playwrightCacheSegment = "/ms-playwright/"

// browserDaemonScript is the tail of the script path haven's browser daemon
// runs as, wherever the checkout it runs from lives.
const browserDaemonScript = "/apps/haven-web/scripts/browser-daemon.ts"

// HavenBrowserDaemonOwner names haven's own daemon when it is matched by its
// script rather than by a checkout root.
const HavenBrowserDaemonOwner = "haven browser daemon"

// HeadlessShellOwner is the whole selection rule. A command is governed only
// when its binary (by path, never by args) is a headless shell from the
// Playwright cache AND its parent runs a path under a LangWatch checkout root
// (worktrees sit beneath it) or is haven's browser daemon. owner names that
// path relative to its root, so a reap says which tool leaked the browser.
func HeadlessShellOwner(command, parentCommand string, roots []string) (owner string, ok bool) {
	bin, _, _ := strings.Cut(strings.TrimSpace(command), " ")
	if !slices.Contains(headlessShellBinaries, binaryBase(bin)) || !strings.Contains(bin, playwrightCacheSegment) {
		return "", false
	}
	for _, tok := range strings.Fields(parentCommand) {
		for _, root := range roots {
			if root = strings.TrimRight(root, "/"); root != "" && strings.HasPrefix(tok, root+"/") {
				return strings.TrimPrefix(tok, root+"/"), true
			}
		}
	}
	if IsHavenBrowserDaemonCommand(parentCommand) {
		return HavenBrowserDaemonOwner, true
	}
	return "", false
}

// IsHavenBrowserDaemonCommand reports whether a command line is haven's own
// browser daemon: node running apps/haven-web/scripts/browser-daemon.ts.
func IsHavenBrowserDaemonCommand(command string) bool {
	fields := strings.Fields(command)
	if len(fields) < 2 || binaryBase(fields[0]) != "node" {
		return false
	}
	for _, arg := range fields[1:] {
		if strings.HasSuffix(arg, browserDaemonScript) {
			return true
		}
	}
	return false
}

// BrowserShell is one haven headless shell as sampled by the daemon, its
// numbers summed over the shell and every descendant (renderer, GPU, network).
type BrowserShell struct {
	PID     int
	Owner   string // the parent's path under a checkout root, or the daemon
	RSS     int64  // bytes, summed over the group
	Started time.Time
	// HotFor is how long the group's CPU has stayed above the ceiling without
	// a break; IdleFor how long it has stayed below the idle floor. Both are
	// tracked by the sampler across ticks; zero means not (yet) so.
	HotFor  time.Duration
	IdleFor time.Duration
}

// BrowserLimits bound what haven's headless browser may take. Zero disables
// the individual rule; MaxRSS == 0 disables the browser governor entirely.
type BrowserLimits struct {
	MaxRSS     int64         // ceiling for a shell's summed group memory
	MaxCPU     float64       // percent of one core, summed over the group
	CPUSustain time.Duration // how long CPU must stay above MaxCPU
	MaxAge     time.Duration // an idle shell older than this is reaped
	IdleTTL    time.Duration // how long below the idle floor counts as idle
}

// BrowserIdleCPUPercent is the floor under which a shell's group counts as
// idle: an open page polling the app sits above it, a parked browser below.
const BrowserIdleCPUPercent = 1.0

// LimitBrowserMemory is the shared browser's one memory limit, in MB: the
// daemon unloads idle pages towards it and refuses new lanes above it, and
// the governor kills the browser only above it plus BrowserKillHeadroomMB.
const LimitBrowserMemory = "browser-memory-mb"

// BrowserMemoryEnv is the limit's knob; haven hands it to the daemon it starts.
const BrowserMemoryEnv = "HAVEN_BROWSER_MAX_RSS_MB"

// MinBrowserMemoryMB holds the shared browser plus a few signed-in pages.
const MinBrowserMemoryMB = 2048

// DefaultBrowserMemoryMB is an eighth of the machine's RAM, 2 to 8 GiB.
func DefaultBrowserMemoryMB(totalRAMBytes uint64) int {
	return clampInt(int(totalRAMBytes>>20)/8, MinBrowserMemoryMB, 8192)
}

// BrowserKillHeadroomMB is how far above the limit the governor waits before
// it kills the whole browser: a quarter of the limit, at least 1 GiB.
func BrowserKillHeadroomMB(limitMB int) int { return max(limitMB/4, 1024) }

// BrowserKillRSS is the governor's memory ceiling for a limit, in bytes.
func BrowserKillRSS(limitMB int) int64 {
	return int64(limitMB+BrowserKillHeadroomMB(limitMB)) << 20
}

// DefaultBrowserLimits are the defaults the knobs (HAVEN_BROWSER_SHELL_*) override;
// MaxRSS follows the browser-memory-mb limit, here at its floor.
func DefaultBrowserLimits() BrowserLimits {
	return BrowserLimits{
		MaxRSS:     BrowserKillRSS(MinBrowserMemoryMB),
		MaxCPU:     200,
		CPUSustain: 2 * time.Minute,
		MaxAge:     6 * time.Hour,
		IdleTTL:    15 * time.Minute,
	}
}

// BrowserKill is one enforcement decision, with the reason it carries into the log.
type BrowserKill struct {
	PID     int
	Owner   string
	RSS     int64
	Started time.Time
	Reason  string
}

// GovernBrowser decides which haven headless shells to reap at time now.
func GovernBrowser(shells []BrowserShell, l BrowserLimits, now time.Time) []BrowserKill {
	if l.MaxRSS <= 0 {
		return nil
	}
	var kills []BrowserKill
	for _, s := range shells {
		if reason, over := browserOverLimit(s, l, now); over {
			kills = append(kills, BrowserKill{PID: s.PID, Owner: s.Owner, RSS: s.RSS, Started: s.Started, Reason: reason})
		}
	}
	return kills
}

// browserOverLimit is the per-shell rule and the reason it is reaped.
func browserOverLimit(s BrowserShell, l BrowserLimits, now time.Time) (string, bool) {
	switch {
	case s.RSS > l.MaxRSS:
		return "headless browser exceeds its memory ceiling", true
	case l.MaxCPU > 0 && l.CPUSustain > 0 && s.HotFor >= l.CPUSustain:
		return "headless browser held its CPU ceiling past the sustain period", true
	case l.MaxAge > 0 && l.IdleTTL > 0 && now.Sub(s.Started) >= l.MaxAge && s.IdleFor >= l.IdleTTL:
		return "idle headless browser older than its maximum age", true
	}
	return "", false
}
