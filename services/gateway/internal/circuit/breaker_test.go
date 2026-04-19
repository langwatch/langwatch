package circuit

import (
	"testing"
	"time"
)

// TestClosed_AllAllowed asserts the breaker defaults to closed (request
// passes) and that a single success keeps it closed.
func TestClosed_AllAllowed(t *testing.T) {
	r := NewRegistry(Options{FailureLimit: 3, Window: time.Minute, OpenFor: time.Minute})
	if !r.Allow("pc_a") {
		t.Fatal("expected allow when closed")
	}
	r.RecordSuccess("pc_a")
	if s := r.State("pc_a"); s != StateClosed {
		t.Errorf("state should stay closed after success, got %v", s)
	}
}

// TestOpensAfterLimit checks that N consecutive failures in window open
// the breaker and block further calls.
func TestOpensAfterLimit(t *testing.T) {
	r := NewRegistry(Options{FailureLimit: 3, Window: time.Minute, OpenFor: time.Minute})
	for i := 0; i < 3; i++ {
		if !r.Allow("pc_a") {
			t.Fatalf("expected allow on attempt %d", i)
		}
		r.RecordFailure("pc_a")
	}
	if r.Allow("pc_a") {
		t.Error("expected block after reaching failure limit")
	}
	if s := r.State("pc_a"); s != StateOpen {
		t.Errorf("state should be open, got %v", s)
	}
}

// TestOpenFor_TransitionsToHalfOpen checks that after OpenFor elapses
// the breaker admits exactly one probe request.
func TestOpenFor_TransitionsToHalfOpen(t *testing.T) {
	now := time.Now()
	clock := now
	r := NewRegistry(Options{
		FailureLimit: 2,
		Window:       time.Minute,
		OpenFor:      30 * time.Second,
		Clock:        func() time.Time { return clock },
	})
	// Trip the breaker.
	for i := 0; i < 2; i++ {
		_ = r.Allow("pc_a")
		r.RecordFailure("pc_a")
	}
	if r.Allow("pc_a") {
		t.Fatal("expected open to block")
	}
	// Advance past OpenFor.
	clock = now.Add(31 * time.Second)
	if !r.Allow("pc_a") {
		t.Fatal("expected half-open probe to pass")
	}
	// Second call should be blocked while the probe is still in flight.
	if r.Allow("pc_a") {
		t.Error("expected second half-open attempt to block (probe already in flight)")
	}
	// Probe succeeds → closed → further calls pass.
	r.RecordSuccess("pc_a")
	if !r.Allow("pc_a") {
		t.Error("expected closed after successful probe")
	}
}

// TestHalfOpen_FailureReopens asserts the breaker reopens immediately
// if the probe fails.
func TestHalfOpen_FailureReopens(t *testing.T) {
	now := time.Now()
	clock := now
	r := NewRegistry(Options{
		FailureLimit: 1,
		Window:       time.Minute,
		OpenFor:      10 * time.Second,
		Clock:        func() time.Time { return clock },
	})
	_ = r.Allow("pc_a")
	r.RecordFailure("pc_a")
	// Advance to half-open window.
	clock = now.Add(11 * time.Second)
	if !r.Allow("pc_a") {
		t.Fatal("expected half-open probe")
	}
	r.RecordFailure("pc_a")
	if r.Allow("pc_a") {
		t.Error("expected immediate reopen after probe failure")
	}
}

// TestSlidingWindow_DropsOldFailures makes sure failures outside the
// window no longer count toward the limit.
func TestSlidingWindow_DropsOldFailures(t *testing.T) {
	now := time.Now()
	clock := now
	r := NewRegistry(Options{
		FailureLimit: 3,
		Window:       30 * time.Second,
		OpenFor:      time.Minute,
		Clock:        func() time.Time { return clock },
	})
	// 2 failures at t0.
	for i := 0; i < 2; i++ {
		_ = r.Allow("pc_a")
		r.RecordFailure("pc_a")
	}
	// Advance past window; those failures should now be pruned.
	clock = now.Add(31 * time.Second)
	_ = r.Allow("pc_a")
	r.RecordFailure("pc_a")
	if !r.Allow("pc_a") {
		t.Error("expected pruning: 1 fresh failure shouldn't trip a 3-fail limit")
	}
}

// TestIsolatedSlots makes sure slots don't interfere.
func TestIsolatedSlots(t *testing.T) {
	r := NewRegistry(Options{FailureLimit: 2, Window: time.Minute, OpenFor: time.Minute})
	for i := 0; i < 2; i++ {
		_ = r.Allow("pc_a")
		r.RecordFailure("pc_a")
	}
	if r.Allow("pc_a") {
		t.Error("pc_a should be open")
	}
	if !r.Allow("pc_b") {
		t.Error("pc_b should be independent")
	}
}
