package domain

import (
	"fmt"
	"time"
)

// RetryHint is what haven tells a caller it could not serve: where it sits in
// the queue, and when coming back would be worth its while.
//
// It is information, not a reservation. An earlier design held the place too —
// take a number, keep it across the absence — which fixes starvation but needs
// a store, an expiry and a reclaim, exactly the bookkeeping a flock avoids by
// dying with its holder. It also needs the caller to cooperate: a flock does
// not care what anyone believes, whereas a held place is prose handed to a
// client that may come back early, come back late, or rephrase the command and
// try again. That half is deliberately not built until the counters show
// starvation actually happening — see ConsecutiveRefusals.
//
// What is built is the honest half, and it costs arithmetic: a refusal that
// says "position 4, try again in about 90 seconds" lets a caller do something
// useful instead of guessing, and a caller that comes back to the same queue is
// no worse off than one that never left.
type RetryHint struct {
	// Position is how many runs are ahead, 1 meaning next.
	Position int
	// RetryAfter is how long to wait before trying again. NEVER longer than the
	// caller's cache window — see NewRetryHint.
	RetryAfter time.Duration
}

// EstimateWait is how long a caller at this position should expect to wait.
//
// median is the observed duration of runs of this kind. With nothing observed
// there is no honest estimate, and the caller is told there is none rather than
// handed a number invented for the sake of having one.
func EstimateWait(position int, median time.Duration) (time.Duration, bool) {
	if position < 1 || median <= 0 {
		return 0, false
	}
	return time.Duration(position) * median, true
}

// NewRetryHint quotes a position and a time to come back, or reports that it
// cannot quote one honestly.
//
// The cap is the whole point. A hint is only issued when the estimate fits
// inside the caller's wait ceiling, which itself sits under its prompt-cache
// floor — so haven can never tell an agent to come back at a moment when its
// cache will already be gone. A queue too deep to quote inside that window
// yields no hint at all, and the decision falls through to backgrounding the
// run rather than sending the caller away with a comfortable lie.
func NewRetryHint(position int, median time.Duration, caller CallerKind) (RetryHint, bool) {
	estimate, ok := EstimateWait(position, median)
	if !ok || estimate > caller.WaitCeiling() {
		return RetryHint{}, false
	}
	return RetryHint{Position: position, RetryAfter: estimate}, true
}

// WithinWindow is the invariant this rests on: the time a caller is told to
// come back is always inside the cache window it is in. Written as a function
// so a test can hold the design to it directly rather than by inspection.
func (h RetryHint) WithinWindow(caller CallerKind) bool {
	return h.RetryAfter <= caller.WaitCeiling() && h.RetryAfter < caller.CacheFloor()
}

// Describe renders a hint into the refusal reason, which is the only channel to
// the model. It leads with the wait rather than the position, because the wait
// is what decides what the caller does next.
func (h RetryHint) Describe() string {
	return fmt.Sprintf("try again in about %s (position %d in the queue)",
		h.RetryAfter.Round(time.Second), h.Position)
}

// StarvationThreshold is how many times the same command may be refused in a
// row before the counters are saying something worth acting on.
//
// This is the measurement that decides whether the reservation half above ever
// gets built. A caller repeatedly refused while others are served is starving,
// and only then does holding its place pay for the bookkeeping it costs. If the
// number stays at zero, a subsystem was saved.
const StarvationThreshold = 3

// Starving reports whether a run of consecutive refusals has gone past the
// point of being bad luck.
func Starving(consecutiveRefusals int) bool {
	return consecutiveRefusals >= StarvationThreshold
}
