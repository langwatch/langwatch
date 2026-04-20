package fallback

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/langwatch/langwatch/services/gateway/internal/auth"
	"github.com/langwatch/langwatch/services/gateway/internal/circuit"
)

type testErr struct {
	msg    string
	reason Reason
}

func (e *testErr) Error() string { return e.msg }

func classify(err error) Reason {
	if te, ok := err.(*testErr); ok {
		return te.reason
	}
	return ReasonNonRetryable
}

// TestPrimarySucceeds — happy path: no fallback invoked.
func TestPrimarySucceeds(t *testing.T) {
	eng := New(Options{})
	try := func(_ context.Context, cred string) (string, error, bool) {
		return "ok:" + cred, nil, false
	}
	res, events, err := Walk(context.Background(), eng, auth.FallbackSpec{},
		[]string{"pc_primary", "pc_secondary"}, try, classify)
	if err != nil || res != "ok:pc_primary" {
		t.Fatalf("want primary ok, got %q err=%v", res, err)
	}
	if len(events) != 1 || events[0].Reason != ReasonPrimarySuccess {
		t.Errorf("events %+v", events)
	}
}

// TestFallsOverOn5xx — primary 5xx → secondary serves.
func TestFallsOverOn5xx(t *testing.T) {
	eng := New(Options{})
	try := func(_ context.Context, cred string) (string, error, bool) {
		if cred == "pc_primary" {
			return "", &testErr{msg: "upstream 503", reason: ReasonRetryable5xx}, true
		}
		return "served_by:" + cred, nil, false
	}
	res, events, err := Walk(context.Background(), eng, auth.FallbackSpec{},
		[]string{"pc_primary", "pc_secondary"}, try, classify)
	if err != nil || res != "served_by:pc_secondary" {
		t.Fatalf("expected secondary to serve, got %q err=%v", res, err)
	}
	if len(events) != 2 {
		t.Fatalf("expected 2 events, got %d", len(events))
	}
	if events[0].Reason != ReasonRetryable5xx || events[1].Reason != ReasonFallbackSuccess {
		t.Errorf("wrong reasons: %v / %v", events[0].Reason, events[1].Reason)
	}
}

// TestDoesNotFailOver_On4xx — 400 class: no retry.
func TestDoesNotFailOver_On4xx(t *testing.T) {
	eng := New(Options{})
	called := 0
	try := func(_ context.Context, _ string) (string, error, bool) {
		called++
		return "", errors.New("bad request"), false // retryable=false
	}
	_, events, err := Walk(context.Background(), eng, auth.FallbackSpec{},
		[]string{"pc_primary", "pc_secondary"}, try, classify)
	if err == nil {
		t.Fatal("expected error")
	}
	if called != 1 {
		t.Errorf("expected only 1 attempt (no fallback on 4xx); got %d", called)
	}
	if len(events) != 1 || events[0].Reason != ReasonNonRetryable {
		t.Errorf("events %+v", events)
	}
}

// TestChainExhausted — every slot fails with retryable errors.
func TestChainExhausted(t *testing.T) {
	eng := New(Options{})
	calls := 0
	try := func(_ context.Context, _ string) (string, error, bool) {
		calls++
		return "", &testErr{msg: "upstream 500", reason: ReasonRetryable5xx}, true
	}
	_, events, err := Walk(context.Background(), eng, auth.FallbackSpec{},
		[]string{"pc_primary", "pc_secondary", "pc_tertiary"}, try, classify)
	if err == nil {
		t.Fatal("expected error after exhaustion")
	}
	if calls != 3 {
		t.Errorf("expected 3 attempts, got %d", calls)
	}
	if len(events) != 3 {
		t.Errorf("expected 3 events, got %d", len(events))
	}
}

// TestMaxAttempts_Spec — VK spec caps attempts below chain length.
func TestMaxAttempts_Spec(t *testing.T) {
	eng := New(Options{})
	calls := 0
	try := func(_ context.Context, _ string) (string, error, bool) {
		calls++
		return "", &testErr{msg: "500", reason: ReasonRetryable5xx}, true
	}
	_, _, err := Walk(context.Background(), eng, auth.FallbackSpec{MaxAttempts: 2},
		[]string{"pc_primary", "pc_secondary", "pc_tertiary"}, try, classify)
	if err == nil {
		t.Fatal("expected error")
	}
	if calls != 2 {
		t.Errorf("expected 2 attempts (capped), got %d", calls)
	}
}

// TestCircuitOpen_SkipsSlot — open breaker skips the slot without calling try.
func TestCircuitOpen_SkipsSlot(t *testing.T) {
	reg := circuit.NewRegistry(circuit.Options{FailureLimit: 1, Window: time.Minute, OpenFor: time.Minute})
	// Trip pc_primary: 1 failure opens the breaker.
	_ = reg.Allow("pc_primary")
	reg.RecordFailure("pc_primary")
	eng := New(Options{Breakers: reg})
	calls := map[string]int{}
	try := func(_ context.Context, cred string) (string, error, bool) {
		calls[cred]++
		return "served_by:" + cred, nil, false
	}
	res, events, err := Walk(context.Background(), eng, auth.FallbackSpec{},
		[]string{"pc_primary", "pc_secondary"}, try, classify)
	if err != nil {
		t.Fatalf("err %v", err)
	}
	if res != "served_by:pc_secondary" {
		t.Errorf("expected secondary to serve since primary breaker is open, got %q", res)
	}
	if calls["pc_primary"] != 0 {
		t.Errorf("expected primary to be skipped; got %d calls", calls["pc_primary"])
	}
	if events[0].Reason != ReasonCircuitOpen {
		t.Errorf("first event should be circuit_open, got %v", events[0].Reason)
	}
}

// TestTriggerFiltering — spec.On limits triggers; a non-listed reason halts walk.
func TestTriggerFiltering(t *testing.T) {
	eng := New(Options{})
	calls := 0
	try := func(_ context.Context, _ string) (string, error, bool) {
		calls++
		return "", &testErr{msg: "429", reason: ReasonRetryable429}, true
	}
	// VK opts out of rate_limit fallback (only 5xx + timeout).
	_, _, err := Walk(context.Background(), eng,
		auth.FallbackSpec{On: []string{"5xx", "timeout"}},
		[]string{"pc_primary", "pc_secondary"}, try, classify)
	if err == nil {
		t.Fatal("expected error")
	}
	if calls != 1 {
		t.Errorf("expected 1 attempt (429 not a trigger), got %d", calls)
	}
}
