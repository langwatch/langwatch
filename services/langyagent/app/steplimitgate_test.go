package app

import (
	"testing"

	"github.com/langwatch/langwatch/services/langyagent/internal/frames"
)

// Settled tool calls under the ceiling leave the turn alone.
func TestStepLimitGate_UnderLimit(t *testing.T) {
	cancelled := false
	gate := newStepLimitGate(3, func() { cancelled = true })

	gate.Observe(toolEndFrame(t, "langwatch trace search", false, ""))
	gate.Observe(toolEndFrame(t, "langwatch trace get t1", false, ""))

	if gate.Tripped() {
		t.Error("must not trip below the limit")
	}
	if cancelled {
		t.Error("must not cancel below the limit")
	}
}

// Reaching the ceiling trips the gate and cancels the stream so driveTurn can
// emit the vetted terminal frame.
func TestStepLimitGate_ReachesLimit(t *testing.T) {
	cancels := 0
	gate := newStepLimitGate(3, func() { cancels++ })

	for range 3 {
		gate.Observe(toolEndFrame(t, "langwatch monitor create --name x", true, "forbidden"))
	}

	if !gate.Tripped() {
		t.Fatal("must trip on reaching the limit")
	}
	if cancels != 1 {
		t.Fatalf("must cancel exactly once, got %d", cancels)
	}

	// Frames after the trip must not cancel again — the gate trips at most once.
	gate.Observe(toolEndFrame(t, "langwatch monitor create --name x", true, "forbidden"))
	if cancels != 1 {
		t.Fatalf("must not cancel again after tripping, got %d", cancels)
	}
}

// Only SETTLED tool calls (phase "end") count. A start frame is the same call's
// other half; counting both would halve the effective ceiling.
func TestStepLimitGate_IgnoresNonSettledAndNonTool(t *testing.T) {
	cancelled := false
	gate := newStepLimitGate(2, func() { cancelled = true })

	// Two starts + a plain delta = zero settled calls.
	gate.Observe(toolStartFrameFor(t, "langwatch trace search"))
	gate.Observe(toolStartFrameFor(t, "langwatch trace get t1"))
	if delta, err := frames.Delta("thinking about it"); err == nil {
		gate.Observe(delta)
	}

	if gate.Tripped() || cancelled {
		t.Error("start frames and deltas must not count toward the tool-call ceiling")
	}
}

// A zero (or negative) limit disables the gate rather than tripping on the
// first call.
func TestStepLimitGate_ZeroLimitDisabled(t *testing.T) {
	gate := newStepLimitGate(0, func() { t.Error("a disabled gate must never cancel") })
	for range 5 {
		gate.Observe(toolEndFrame(t, "langwatch trace search", false, ""))
	}
	if gate.Tripped() {
		t.Error("a zero limit must disable the gate")
	}
}
