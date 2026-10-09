package app

import (
	"context"
	"time"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// keeperCrashLoop respawns inside keeperCrashWindow is D3's give-up: the stack
// is reaped instead of respawned again.
const (
	keeperCrashLoop   = 5
	keeperCrashWindow = 10 * time.Minute
)

// superviseKeeper is the tick's answer for a stack a keeper runs (section 11.6
// of dev/docs/plans/haven-one-go-process-2026-10-09.md): an owner gone downs
// it, a dead keeper with a plan is respawned. False leaves s to the reaper.
func (o *Orchestrator) superviseKeeper(s domain.Stack) bool {
	if s.LauncherPID == 0 {
		return false
	}
	ownerGone := s.OwnerPID != 0 && !o.pidIsOurs(s.OwnerPID, s.OwnerStart)
	if o.launcherIsOurs(s) {
		if !ownerGone {
			return false
		}
		_ = o.DownStack(context.Background(), s.Slug)
		o.recordReap("stack", s.Slug, "owner gone")
		return true
	}
	if ownerGone {
		return false
	}
	plan, err := o.ReadKeeperPlan(s.Slug)
	if err != nil || s.LauncherPID == plan.ProvisionerPID {
		return false // no plan, or the up died before its hand-over: reaped as today
	}
	return o.respawnKeeper(s)
}

// respawnKeeper starts a dead keeper's successor from its plan, with backoff
// (1 s doubling to 60 s) and a give-up. It never blocks the tick: an up or a
// down holding `up-<slug>` defers it, and the record is re-read under that lock.
// The new keeper's Supervise reaps the dead one's orphaned lanes on start.
func (o *Orchestrator) respawnKeeper(s domain.Stack) bool {
	now := o.sys.Now()
	recent := o.recentRespawns(s.Slug, now)
	if len(recent) >= keeperCrashLoop {
		_ = o.DownStack(context.Background(), s.Slug)
		delete(o.keeperRespawns, s.Slug)
		o.recordReap("stack", s.Slug, "keeper crash loop")
		return true
	}
	if n := len(recent); n > 0 && now.Before(recent[n-1].Add(min(time.Second<<(n-1), time.Minute))) {
		return true
	}
	if o.sem != nil {
		release, _, ok, err := o.sem.TryAcquire("up-"+s.Slug, 1)
		if err != nil || !ok {
			return true
		}
		defer release()
	}
	cur, ok := o.stackBySlug(s.Slug)
	if !ok || cur.LauncherPID != s.LauncherPID {
		return true
	}
	o.keeperRespawns[s.Slug] = append(recent, now)
	if err := o.spawnKeeper(cur); err != nil {
		o.log.Warn("could not respawn keeper", zap.String("slug", s.Slug), zap.Error(err))
		return true
	}
	o.recordReap("keeper", s.Slug, "keeper died; respawned")
	return true
}

// recentRespawns is slug's respawns inside the crash window, oldest first.
func (o *Orchestrator) recentRespawns(slug string, now time.Time) []time.Time {
	if o.keeperRespawns == nil {
		o.keeperRespawns = map[string][]time.Time{}
	}
	var recent []time.Time
	for _, at := range o.keeperRespawns[slug] {
		if now.Sub(at) < keeperCrashWindow {
			recent = append(recent, at)
		}
	}
	return recent
}
