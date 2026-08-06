package domain

import "time"

// RunKind is what sort of heavy work is asking for a slot. It matters because
// only one of them can be narrowed.
type RunKind int

const (
	// UnitRun is a unit test run: many workers, divisible, so narrowable.
	UnitRun RunKind = iota
	// IntegrationRun is an integration suite. NEVER narrowed:
	// specs/setup/integration-file-serialism.feature owns its concurrency, the
	// config already clamps it to one worker locally, and a worker count arriving
	// from the environment is withdrawn — or, if a second worker appears anyway,
	// fails the run naming the count that re-enabled concurrency.
	IntegrationRun
	// SingleProcessRun is a typecheck, lint or build: one process, nothing to
	// divide, so it queues or it runs.
	SingleProcessRun
)

// Narrowable reports whether this kind of run can trade workers for admission.
func (k RunKind) Narrowable() bool { return k == UnitRun }

// Admission is what haven decided to do with a heavy run.
type Admission int

const (
	// Admit runs it now, unchanged.
	Admit Admission = iota
	// Narrow runs it now with fewer workers, consuming a slot like any other run.
	Narrow
	// Queue waits for a slot, blocking the caller.
	//
	// This is the right answer whenever the wait fits inside the caller's
	// ceiling, agent or not: blocking for forty seconds is cheaper than a round
	// trip, and it keeps the tool call meaning what it says. Returning control
	// early only earns its keep once the wait no longer fits — and then the
	// answer is to background the run, not to hand back a number.
	Queue
	// Background hands the run back to run detached, so the caller keeps working
	// and is notified when it finishes.
	//
	// This is what a wait too long to serve becomes. Blocking would park the
	// caller past its cache floor; refusing would cost a turn and invite a retry
	// into the same queue. Backgrounding does the work and reports later, and a
	// caller that polls sees the queue position meanwhile.
	//
	// It is deliberately NOT the answer to a short wait: returning immediately
	// from a run the caller meant to gate its next step on breaks causality, and
	// that is only worth risking where the alternative was a refusal — where the
	// caller was not getting its result this turn regardless.
	Background
	// Refuse declines, with a reason.
	Refuse
)

// String renders a decision for the doctor's counters.
func (a Admission) String() string {
	switch a {
	case Narrow:
		return "narrowed"
	case Queue:
		return "queued"
	case Background:
		return "backgrounded"
	case Refuse:
		return "refused"
	default:
		return "admitted"
	}
}

// AdmissionRequest is everything the decision needs. Duration is what haven has
// previously observed this command to take; zero means never seen.
type AdmissionRequest struct {
	Pressure         Pressure
	SlotFree         bool
	Caller           CallerKind
	Kind             RunKind
	ObservedDuration time.Duration
	// CallerSetWorkers is true when the command already carries a worker count.
	// It is respected rather than overridden, but the run is still admitted,
	// queued or refused by the same rules as any other.
	CallerSetWorkers bool
	// EstimatedWait is how long this run would sit in the queue. It decides
	// between blocking and backgrounding: a wait the caller can afford is served
	// inline, a wait it cannot is handed back detached.
	EstimatedWait time.Duration
	// CanBackground is false for a caller with nowhere to put a detached run —
	// a plain shell invocation rather than a gated tool call. Such a caller
	// queues instead, on the ordinary failsafe.
	CanBackground bool
}

// fitsInsideFloor reports whether a narrowed run would finish before this
// caller's prompt cache expires. An unobserved command never fits: unknown is
// treated as long, because queueing is the answer that cannot make the machine
// worse.
//
// The narrowed run is assumed to take up to twice as long as observed — fewer
// workers, more wall clock — which is the pessimistic direction and keeps the
// decision honest when the estimate is wrong.
func (r AdmissionRequest) fitsInsideFloor() bool {
	if r.ObservedDuration <= 0 {
		return false
	}
	return r.ObservedDuration*2 < r.Caller.CacheFloor()
}

// DecideAdmission implements ADR-090's precedence table.
//
// Red is the only level that refuses, and only when no slot is free — it
// throttles admission, it does not stop the machine working. Amber's job is to
// stop admitting at full width, not to refuse.
//
// Narrowing is reached only by a sub-agent, because a sub-agent is the caller
// whose cache actually expires inside a plausible queue wait. Everyone else
// queues, which holds no memory at all and costs them nothing.
func DecideAdmission(r AdmissionRequest) Admission {
	if r.SlotFree {
		return Admit
	}
	if r.Pressure == Red {
		return Refuse
	}
	if r.Caller == SubAgent && r.Kind.Narrowable() && !r.CallerSetWorkers && r.fitsInsideFloor() {
		return Narrow
	}
	// A wait the caller cannot afford is handed back detached rather than served
	// inline. Blocking would park it past its cache floor; refusing would cost a
	// turn and send it back into the same queue.
	if r.CanBackground && r.EstimatedWait > r.Caller.WaitCeiling() {
		return Background
	}
	return Queue
}

// NarrowedWorkers is how many workers a narrowed run gets.
//
// It divides by the runs actually IN FLIGHT rather than by the configured
// limit. A narrowed run starts without waiting for a slot to free, so sizing
// against the limit would let ten agents each start "narrowed" and reproduce
// the very burst this exists to prevent.
//
// Never below one: a run with no workers never finishes.
func NarrowedWorkers(fullWidth, inFlight int) int {
	fullWidth = max(fullWidth, 1)
	inFlight = max(inFlight, 1)
	return max(fullWidth/inFlight, 1)
}
