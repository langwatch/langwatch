package domain

import "time"

// Priority for the shared check queue (specs/setup/check-slots.feature,
// "Priority with aging"). CallerKind already ranks who is asking; this adds
// how long they have waited and an agent's own claim that a run matters, so
// the queue can decide which waiter gets a slot that just freed rather than
// only who asked first.
//
// A person outranks a main session, which outranks a sub-agent - the same
// order CallerKind already carries. Aging then closes the gap: the longer a
// low-ranked run waits, the closer its effective priority comes to the ranks
// above it, so a sub-agent behind a busy machine is never starved forever,
// only ever slower than a caller who has waited exactly as long.

// classPriorityStep is the gap between two adjacent CallerKind ranks, wide
// enough that PriorityAgeCap (one full step) can carry the lowest rank up to
// the rank above it, and no further on aging alone.
const classPriorityStep = 100

// ClassPriority is a caller's base effective priority before aging or an
// honored HAVEN_PRIORITY=high claim - highest for a person, lowest for a
// sub-agent, spaced by classPriorityStep so nothing below can out-age two
// ranks over the aging cap.
func ClassPriority(caller CallerKind) int {
	switch caller {
	case Interactive:
		return 2 * classPriorityStep
	case MainSession:
		return classPriorityStep
	default: // SubAgent
		return 0
	}
}

// priorityAgeStep is how much effective priority a queued run gains for
// every full minute it has waited.
const priorityAgeStep = 10

// PriorityAgeCap is the most aging alone can ever add - exactly one class
// step, so a sub-agent that has waited long enough catches up to a main
// session's own starting priority, but aging by itself never lets it pass a
// person who queued at the same moment.
const PriorityAgeCap = classPriorityStep

// PriorityAgeBonus is how much a queued run's effective priority has risen
// from having waited elapsed already - aging, so nothing waits forever
// merely for being the lowest rank in the room.
func PriorityAgeBonus(elapsed time.Duration) int {
	bonus := int(elapsed/time.Minute) * priorityAgeStep
	return min(bonus, PriorityAgeCap)
}

// PriorityOverrideBonus is what one honored HAVEN_PRIORITY=high claim adds -
// one class step, the same ceiling aging has. An agent stating "this run
// matters" moves it up a rank; it does not, on its own, let a sub-agent's
// claim jump a person who queued at the same time.
const PriorityOverrideBonus = classPriorityStep

// EffectivePriority is the number the queue orders waiters by, highest
// first: the caller's own rank, plus aging, plus an honored override.
func EffectivePriority(caller CallerKind, waited time.Duration, overrideHonored bool) int {
	p := ClassPriority(caller) + PriorityAgeBonus(waited)
	if overrideHonored {
		p += PriorityOverrideBonus
	}
	return p
}

// PriorityOverrideWindow is how often one agent id's HAVEN_PRIORITY=high
// claim is honored. Without a limit, "this run matters" is not a claim at
// all - every run would carry it, and the aging curve it is meant to sit
// beside would mean nothing.
const PriorityOverrideWindow = 10 * time.Minute

// PriorityOverrideRequest is what PriorityOverrideHonored decides from:
// whether a HAVEN_PRIORITY=high claim was made at all, and the last time (if
// any) one from the same agent id was honored.
type PriorityOverrideRequest struct {
	Requested     bool
	LastHonoredAt time.Time
	// HasLast is false when no earlier claim was found at all, which is
	// always honored - the window only ever limits a repeat.
	HasLast bool
	Now     time.Time
}

// PriorityOverrideHonored reports whether a HAVEN_PRIORITY=high claim should
// be honored right now.
func PriorityOverrideHonored(req PriorityOverrideRequest) bool {
	if !req.Requested {
		return false
	}
	if !req.HasLast {
		return true
	}
	return req.Now.Sub(req.LastHonoredAt) >= PriorityOverrideWindow
}

// PriorityClaimExitCode marks a RunRecord as a priority-claim marker rather
// than a completed run: no real run ever exits with it, so Succeeded is
// always false and it can never enter a duration estimate.
const PriorityClaimExitCode = -1

// NewPriorityClaim is the RunRecord written the moment an agent's
// HAVEN_PRIORITY=high claim is honored - visible in run-history.jsonl beside
// every completed run, but excluded from every one of their estimates.
func NewPriorityClaim(agentID string, at time.Time) RunRecord {
	return RunRecord{
		Kind:             KindOther,
		StartedAt:        at,
		ExitCode:         PriorityClaimExitCode,
		AgentID:          agentID,
		PriorityOverride: true,
	}
}

// LastPriorityClaim is the most recent honored HAVEN_PRIORITY=high claim in
// history for agentID, or ok=false when there is none.
func LastPriorityClaim(history []RunRecord, agentID string) (at time.Time, ok bool) {
	for _, rec := range history {
		if !rec.PriorityOverride || rec.AgentID != agentID {
			continue
		}
		if !ok || rec.StartedAt.After(at) {
			at, ok = rec.StartedAt, true
		}
	}
	return at, ok
}

// WaiterState is what the priority scheduler compares one queued run
// against another on: who is asking, how long they have waited, and whether
// their HAVEN_PRIORITY=high claim was honored.
type WaiterState struct {
	Caller          CallerKind
	Waited          time.Duration
	OverrideHonored bool
}

// Priority is this waiter's own effective priority right now.
func (w WaiterState) Priority() int {
	return EffectivePriority(w.Caller, w.Waited, w.OverrideHonored)
}

// ShouldYield reports that some other currently-queued waiter has a
// strictly higher effective priority than self does right now, so self
// should let this poll tick pass rather than race for a slot that just
// freed. A tie decides nothing here - whoever wins the flock wins - but a
// tie cannot last: the one waiting the same or longer only grows its own
// lead the next tick, which is what keeps this from being a coin flip
// forever between two same-rank waiters.
func ShouldYield(self WaiterState, others []WaiterState) bool {
	mine := self.Priority()
	for _, other := range others {
		if other.Priority() > mine {
			return true
		}
	}
	return false
}
