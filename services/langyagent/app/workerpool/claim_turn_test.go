package workerpool

import (
	"strconv"
	"testing"

	"github.com/langwatch/langwatch/services/langyagent/app"
)

// The turnId-idempotent claim (review "F") is what makes a self-retry re-drive
// safe: the same turnId in flight or recently completed is a benign no-op, a
// different turn is busy, a fresh turn is granted.
func TestClaimTurn_Idempotency(t *testing.T) {
	w := &Worker{}

	if got := w.ClaimTurn("t1"); got != app.ClaimGranted {
		t.Fatalf("first claim = %v, want granted", got)
	}
	// The SAME turn re-dispatched while in flight — the self-retry racing a slow
	// worker — is a benign no-op, never a second run.
	if got := w.ClaimTurn("t1"); got != app.ClaimAlreadyHandled {
		t.Errorf("same in-flight turn = %v, want alreadyHandled", got)
	}
	// A DIFFERENT turn while one is in flight is busy.
	if got := w.ClaimTurn("t2"); got != app.ClaimBusy {
		t.Errorf("different in-flight turn = %v, want busy", got)
	}

	w.Release()
	// After completion, re-dispatching the just-completed turn is still a no-op.
	if got := w.ClaimTurn("t1"); got != app.ClaimAlreadyHandled {
		t.Errorf("recently-completed turn = %v, want alreadyHandled", got)
	}
	// A brand-new turn claims cleanly.
	if got := w.ClaimTurn("t3"); got != app.ClaimGranted {
		t.Errorf("new turn after release = %v, want granted", got)
	}
}

// An empty turnId (older control plane) degrades to the boolean in-flight guard:
// a second concurrent claim is busy, and nothing pollutes the recent set.
func TestClaimTurn_EmptyTurnIDDegradesToBooleanGuard(t *testing.T) {
	w := &Worker{}
	if got := w.ClaimTurn(""); got != app.ClaimGranted {
		t.Fatalf("first empty claim = %v, want granted", got)
	}
	if got := w.ClaimTurn(""); got != app.ClaimBusy {
		t.Errorf("second concurrent empty claim = %v, want busy", got)
	}
	w.Release()
	if len(w.handled) != 0 {
		t.Errorf("empty turnId must not enter the recent set, got %d entries", len(w.handled))
	}
}

// The recently-completed set is capacity-bounded — a worker serves many turns over
// its life and must not grow it without limit.
func TestClaimTurn_RecentSetIsBounded(t *testing.T) {
	w := &Worker{}
	for i := 0; i < recentTurnsCap+5; i++ {
		id := "turn-" + strconv.Itoa(i)
		if got := w.ClaimTurn(id); got != app.ClaimGranted {
			t.Fatalf("claim %s = %v, want granted", id, got)
		}
		w.Release()
	}
	if len(w.handled) > recentTurnsCap {
		t.Errorf("recent set grew to %d, cap is %d", len(w.handled), recentTurnsCap)
	}
	// The most-recent completed turn is still remembered (not evicted).
	last := "turn-" + strconv.Itoa(recentTurnsCap+4)
	if got := w.ClaimTurn(last); got != app.ClaimAlreadyHandled {
		t.Errorf("most-recent completed turn = %v, want alreadyHandled", got)
	}
}
