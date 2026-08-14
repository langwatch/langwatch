package app

import (
	"time"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// The process watch (ADR-095): every daemon tick samples the machine's
// dev-tooling processes — tsgo, gopls, biome, vitest workers, node, bun,
// claude — however they were spawned, ships the footprint to the local
// observability stack, and enforces limits on the one class that has them
// (tsgo). Admission controls bound how much tooling *starts*; this bounds how
// much *exists*, and records enough history to decide which class earns
// limits next.

// tsgoSeen is the cross-tick memory behind idle detection: a process whose CPU
// clock moved since the last tick was active then.
type tsgoSeen struct {
	cpu      time.Duration
	activeAt time.Time
}

// governProcesses runs on every daemon tick. Sampling is one ps invocation;
// with nothing watched alive it records an empty sample and does no more.
func (o *Orchestrator) governProcesses() {
	if o.cfg.Tsgo.RunMaxRSS <= 0 {
		return
	}
	if o.procActivity == nil {
		o.procActivity = map[int]tsgoSeen{}
	}
	now := o.sys.Now()
	watched, tsgo := o.sampleWatched(now)
	if o.procTel != nil {
		o.procTel.RecordSample(watched)
	}
	for _, k := range domain.GovernTsgo(tsgo, o.cfg.Tsgo) {
		o.sys.Kill(k.PID)
		if o.procTel != nil {
			o.procTel.RecordKill("tsgo", k.Reason)
		}
		o.log.Warn("process governor reclaimed tsgo",
			zap.Int("pid", k.PID),
			zap.String("role", string(k.Class)),
			zap.String("rss", domain.HumanBytes(k.RSS)),
			zap.Duration("age", now.Sub(k.Started)),
			zap.String("reason", k.Reason))
	}
}

// sampleWatched classifies the live process listing and maintains the
// cross-tick idle memory. Returns every watched process plus the tsgo subset
// the governor rules on.
func (o *Orchestrator) sampleWatched(now time.Time) (watched []domain.WatchedProcess, tsgo []domain.TsgoProcess) {
	live := map[int]bool{}
	for _, s := range o.sys.ProcessSamples() {
		w, ok := domain.ClassifyWatchedProcess(s.Command)
		if !ok {
			continue
		}
		live[s.PID] = true
		seen, known := o.procActivity[s.PID]
		// Any change in the CPU clock marks the process active now — including
		// a DECREASE, which means the pid was reused by a new process between
		// ticks: inheriting the old entry's activeAt would let a fresh
		// language server be evicted as idle on its first tick.
		if !known || s.CPUTime != seen.cpu {
			seen = tsgoSeen{cpu: s.CPUTime, activeAt: now}
			o.procActivity[s.PID] = seen
		}
		w.PID, w.RSS = s.PID, s.RSSBytes
		w.Started, w.IdleFor = now.Add(-s.Elapsed), now.Sub(seen.activeAt)
		watched = append(watched, w)
		if w.Class == "tsgo" {
			tsgo = append(tsgo, domain.TsgoProcess{
				PID: w.PID, Class: w.Role, RSS: w.RSS, Started: w.Started, IdleFor: w.IdleFor,
			})
		}
	}
	o.pruneDeadActivity(live)
	return watched, tsgo
}

// pruneDeadActivity forgets idle-tracking state for processes no longer alive.
func (o *Orchestrator) pruneDeadActivity(live map[int]bool) {
	for pid := range o.procActivity {
		if !live[pid] {
			delete(o.procActivity, pid)
		}
	}
}
