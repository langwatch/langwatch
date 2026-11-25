package app

import (
	"fmt"
	"time"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// browserSeen is the cross-tick memory behind a shell's CPU rate: the group's
// CPU clock at the last tick, and since when it has been hot or idle.
type browserSeen struct {
	started   time.Time
	cpu       time.Duration
	at        time.Time
	hotSince  time.Time
	idleSince time.Time
}

// governBrowser reaps LangWatch's headless shells past their limits. A reap
// kills the shell's process group (renderers and GPU included); haven's browser
// daemon exits on the disconnect, so the next `haven browser` starts afresh.
func (o *Orchestrator) governBrowser(samples []ProcessSample, now time.Time) {
	shells := o.sampleBrowserShells(samples, now)
	for _, k := range domain.GovernBrowser(shells, o.cfg.Browser, now) {
		o.sys.KillGroup(k.PID)
		delete(o.browserActivity, k.PID)
		if o.procTel != nil {
			o.procTel.RecordKill(domain.HeadlessBrowserClass, k.Reason)
		}
		o.recordReap(domain.HeadlessBrowserClass, fmt.Sprintf("pid %d (headless shell of %s, %s)", k.PID, k.Owner, domain.HumanBytes(k.RSS)), k.Reason)
		o.log.Warn("process governor reclaimed the headless browser",
			zap.Int("pid", k.PID),
			zap.String("owner", k.Owner),
			zap.String("rss", domain.HumanBytes(k.RSS)),
			zap.Duration("age", now.Sub(k.Started)),
			zap.String("reason", k.Reason))
	}
}

// sampleBrowserShells selects LangWatch's headless shells from the listing,
// sums each one's descendants into it and advances the cross-tick CPU clock.
func (o *Orchestrator) sampleBrowserShells(samples []ProcessSample, now time.Time) []domain.BrowserShell {
	if o.browserActivity == nil {
		o.browserActivity = map[int]browserSeen{}
	}
	byPID, children := processTree(samples)
	live := map[int]bool{}
	var shells []domain.BrowserShell
	for _, s := range samples {
		owner, ok := domain.HeadlessShellOwner(s.Command, byPID[s.PPID].Command, o.cfg.BrowserOwnerRoots)
		if !ok {
			continue
		}
		live[s.PID] = true
		rss, cpu := groupTotals(s.PID, byPID, children)
		tick := browserTick{started: now.Add(-s.Elapsed), cpu: cpu, now: now}
		seen := o.browserActivity[s.PID].advance(tick, o.cfg.Browser.MaxCPU)
		o.browserActivity[s.PID] = seen
		shells = append(shells, seen.shell(domain.BrowserShell{PID: s.PID, Owner: owner, RSS: rss}, now))
	}
	o.pruneBrowserActivity(live)
	return shells
}

// processTree indexes a listing by pid and by parent.
func processTree(samples []ProcessSample) (byPID map[int]ProcessSample, children map[int][]int) {
	byPID = make(map[int]ProcessSample, len(samples))
	children = map[int][]int{}
	for _, s := range samples {
		byPID[s.PID] = s
		children[s.PPID] = append(children[s.PPID], s.PID)
	}
	return byPID, children
}

// pruneBrowserActivity forgets the clocks of shells no longer alive.
func (o *Orchestrator) pruneBrowserActivity(live map[int]bool) {
	for pid := range o.browserActivity {
		if !live[pid] {
			delete(o.browserActivity, pid)
		}
	}
}

// browserTick is one sample of a shell's group: when it started, its summed
// CPU clock and the sample time.
type browserTick struct {
	started time.Time
	cpu     time.Duration
	now     time.Time
}

// advance moves a shell's clock on by a tick. A first sighting, a reused pid
// or a CPU clock that went down (a renderer exited) re-baselines the rate;
// hot and idle runs survive only an unbroken series of ticks.
func (prev browserSeen) advance(t browserTick, maxCPU float64) browserSeen {
	next := browserSeen{started: t.started, cpu: t.cpu, at: t.now}
	reused := prev.started.Sub(t.started).Abs() > 5*time.Second
	if prev.at.IsZero() || reused || t.cpu < prev.cpu || !t.now.After(prev.at) {
		if !reused {
			next.hotSince, next.idleSince = prev.hotSince, prev.idleSince
		}
		return next
	}
	pct := float64(t.cpu-prev.cpu) / float64(t.now.Sub(prev.at)) * 100
	if maxCPU > 0 && pct > maxCPU {
		next.hotSince = firstOf(prev.hotSince, prev.at)
	}
	if pct < domain.BrowserIdleCPUPercent {
		next.idleSince = firstOf(prev.idleSince, prev.at)
	}
	return next
}

// shell completes the governor's view of a tracked shell at now.
func (seen browserSeen) shell(shell domain.BrowserShell, now time.Time) domain.BrowserShell {
	shell.Started = seen.started
	if !seen.hotSince.IsZero() {
		shell.HotFor = now.Sub(seen.hotSince)
	}
	if !seen.idleSince.IsZero() {
		shell.IdleFor = now.Sub(seen.idleSince)
	}
	return shell
}

// firstOf keeps an already-running window's start, or opens one at t.
func firstOf(since, t time.Time) time.Time {
	if since.IsZero() {
		return t
	}
	return since
}

// groupTotals sums memory and CPU clock over pid and every descendant.
func groupTotals(pid int, byPID map[int]ProcessSample, children map[int][]int) (rss int64, cpu time.Duration) {
	visited := map[int]bool{}
	stack := []int{pid}
	for len(stack) > 0 {
		p := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		if visited[p] {
			continue
		}
		visited[p] = true
		rss += byPID[p].RSSBytes
		cpu += byPID[p].CPUTime
		stack = append(stack, children[p]...)
	}
	return rss, cpu
}
