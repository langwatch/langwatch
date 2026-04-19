package budget

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/langwatch/langwatch/services/gateway/internal/auth"
)

func quiet() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

func bundleWith(budgets []auth.BudgetSpec) *auth.Bundle {
	return &auth.Bundle{
		JWTClaims: auth.JWTClaims{VirtualKeyID: "vk_1"},
		Config:    &auth.Config{VirtualKeyID: "vk_1", Budgets: budgets},
	}
}

func TestPrecheckAllowWhenUnderLimit(t *testing.T) {
	b := bundleWith([]auth.BudgetSpec{{Scope: "vk", Window: "day", LimitUSD: 10, SpentUSD: 4.12, OnBreach: "block"}})
	r := Precheck(b, 0.012)
	if r.Decision != DecisionAllow {
		t.Fatalf("expected allow, got %s (%s)", r.Decision, r.Reason)
	}
}

func TestPrecheckBlockWhenEstimateBreaches(t *testing.T) {
	b := bundleWith([]auth.BudgetSpec{{Scope: "project", Window: "month", LimitUSD: 10, SpentUSD: 9.9999, OnBreach: "block"}})
	r := Precheck(b, 0.002)
	if r.Decision != DecisionHardStop {
		t.Fatalf("expected hard_block, got %s", r.Decision)
	}
	if r.Reason == "" {
		t.Error("expected a reason string")
	}
}

func TestPrecheckWarnAt90Pct(t *testing.T) {
	b := bundleWith([]auth.BudgetSpec{{Scope: "team", Window: "month", LimitUSD: 100, SpentUSD: 92, OnBreach: "warn"}})
	r := Precheck(b, 1)
	if r.Decision != DecisionSoftWarn || len(r.Warnings) != 1 {
		t.Fatalf("expected soft_warn with 1 warning, got %s warnings=%+v", r.Decision, r.Warnings)
	}
	if r.Warnings[0].Scope != "team" {
		t.Errorf("warning scope: %s", r.Warnings[0].Scope)
	}
}

func TestPrecheckBlockOverridesWarn(t *testing.T) {
	b := bundleWith([]auth.BudgetSpec{
		{Scope: "team", Window: "month", LimitUSD: 100, SpentUSD: 92, OnBreach: "warn"},
		{Scope: "project", Window: "day", LimitUSD: 5, SpentUSD: 4.99, OnBreach: "block"},
	})
	r := Precheck(b, 0.02)
	if r.Decision != DecisionHardStop {
		t.Fatalf("expected hard_block to override warn, got %s", r.Decision)
	}
}

func TestPrecheckNilBundleAllows(t *testing.T) {
	r := Precheck(nil, 0.5)
	if r.Decision != DecisionAllow {
		t.Fatalf("nil bundle should allow (fail open), got %s", r.Decision)
	}
}

// --- Outbox tests -----------------------------------------------------------

func newTestOutbox(t *testing.T, endpoint string) *Outbox {
	t.Helper()
	ob := NewOutbox(OutboxOptions{
		ControlPlaneBaseURL: endpoint,
		Sign:                nil, // unsigned in tests; server skips verify
		Logger:              quiet(),
		HTTPTimeout:         500 * time.Millisecond,
		FlushEvery:          50 * time.Millisecond,
		MaxRetries:          3,
		Capacity:            10,
	})
	return ob
}

func TestOutboxFlushesBatchToControlPlane(t *testing.T) {
	var got atomic.Int32
	var capturedIDs []string
	var mu atomic.Bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/internal/gateway/budget/debit" {
			t.Errorf("path: %s", r.URL.Path)
		}
		var ev DebitEvent
		if err := json.NewDecoder(r.Body).Decode(&ev); err != nil {
			t.Errorf("decode: %v", err)
		}
		for !mu.CompareAndSwap(false, true) {
		}
		capturedIDs = append(capturedIDs, ev.GatewayRequestID)
		mu.Store(false)
		got.Add(1)
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	ob := newTestOutbox(t, srv.URL)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	ob.Start(ctx)
	defer ob.Stop()

	ob.Enqueue(DebitEvent{VirtualKeyID: "vk_1", ActualCostUSD: 0.002, Tokens: Tokens{Input: 100, Output: 50}, Model: "gpt-5-mini", ProviderSlot: "primary", Status: "success"})
	ob.Enqueue(DebitEvent{GatewayRequestID: "grq_known", VirtualKeyID: "vk_1", ActualCostUSD: 0.005, Status: "success"})
	ob.Enqueue(DebitEvent{VirtualKeyID: "vk_1", ActualCostUSD: 0.001, Status: "success"})

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) && got.Load() < 3 {
		time.Sleep(20 * time.Millisecond)
	}
	if got.Load() != 3 {
		t.Fatalf("expected 3 debits, got %d", got.Load())
	}
	// Every event should have an ID (auto-generated if caller omitted).
	for !mu.CompareAndSwap(false, true) {
	}
	defer mu.Store(false)
	sawKnown := false
	for _, id := range capturedIDs {
		if id == "" {
			t.Error("event posted with empty gateway_request_id")
		}
		if id == "grq_known" {
			sawKnown = true
		}
	}
	if !sawKnown {
		t.Error("caller-supplied id was not preserved")
	}
}

func TestOutboxRetriesOn5xxThenSucceeds(t *testing.T) {
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := calls.Add(1)
		if n < 2 {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()
	ob := newTestOutbox(t, srv.URL)
	// Smaller backoff for fast test.
	ob.maxRetries = 3
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	ob.Start(ctx)
	defer ob.Stop()

	ob.Enqueue(DebitEvent{VirtualKeyID: "vk_1", ActualCostUSD: 0.001, Status: "success"})
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) && calls.Load() < 2 {
		time.Sleep(50 * time.Millisecond)
	}
	if calls.Load() < 2 {
		t.Fatalf("expected ≥2 attempts, got %d", calls.Load())
	}
	depth, _ := ob.Stats()
	if depth != 0 {
		t.Errorf("outbox should be drained, depth=%d", depth)
	}
}

func TestOutboxDropsWhenCapacityExceeded(t *testing.T) {
	// Server never available → outbox cannot drain → events pile up.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer srv.Close()
	ob := NewOutbox(OutboxOptions{
		ControlPlaneBaseURL: srv.URL,
		Logger:              quiet(),
		HTTPTimeout:         200 * time.Millisecond,
		FlushEvery:          200 * time.Millisecond,
		MaxRetries:          1,
		Capacity:            3,
	})
	for i := 0; i < 6; i++ {
		ob.Enqueue(DebitEvent{VirtualKeyID: "vk_1", ActualCostUSD: 0.001, Status: "success"})
	}
	depth, dropped := ob.Stats()
	if depth > 3 {
		t.Errorf("depth should be capped at 3, got %d", depth)
	}
	if dropped < 3 {
		t.Errorf("expected ≥3 drops, got %d", dropped)
	}
}

func TestOutboxDropsOn4xx(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
	}))
	defer srv.Close()
	ob := newTestOutbox(t, srv.URL)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	ob.Start(ctx)
	defer ob.Stop()

	ob.Enqueue(DebitEvent{VirtualKeyID: "vk_1", ActualCostUSD: 0.001, Status: "success"})
	time.Sleep(300 * time.Millisecond)
	depth, _ := ob.Stats()
	if depth != 0 {
		t.Errorf("4xx should drop the event (not retry forever), depth=%d", depth)
	}
}

func TestOutboxMetricsHookFiresOnCapacityDrop(t *testing.T) {
	var drops atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer srv.Close()
	ob := NewOutbox(OutboxOptions{
		ControlPlaneBaseURL: srv.URL,
		Logger:              quiet(),
		HTTPTimeout:         100 * time.Millisecond,
		FlushEvery:          50 * time.Millisecond,
		MaxRetries:          1,
		Capacity:            2,
		Metrics:             OutboxMetrics{OnCapacityDrop: func() { drops.Add(1) }},
	})
	for i := 0; i < 5; i++ {
		ob.Enqueue(DebitEvent{VirtualKeyID: "vk_1", ActualCostUSD: 0.001, Status: "success"})
	}
	if got := drops.Load(); got < 3 {
		t.Errorf("expected ≥3 hook fires on enqueue overflow, got %d", got)
	}
}

func TestOutboxMetricsHookFiresOnFlushFailure(t *testing.T) {
	var flushFails atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer srv.Close()
	ob := NewOutbox(OutboxOptions{
		ControlPlaneBaseURL: srv.URL,
		Logger:              quiet(),
		HTTPTimeout:         100 * time.Millisecond,
		FlushEvery:          50 * time.Millisecond,
		MaxRetries:          1,
		Capacity:            10,
		Metrics:             OutboxMetrics{OnFlushFailure: func() { flushFails.Add(1) }},
	})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	ob.Start(ctx)
	defer ob.Stop()

	ob.Enqueue(DebitEvent{VirtualKeyID: "vk_1", ActualCostUSD: 0.001, Status: "success"})
	// Wait for at least one flush-fail cycle.
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) && flushFails.Load() < 1 {
		time.Sleep(20 * time.Millisecond)
	}
	if flushFails.Load() < 1 {
		t.Errorf("expected ≥1 flush-failure hook fire, got %d", flushFails.Load())
	}
}

func TestOutboxMetricsHookFiresOn4xxDrop(t *testing.T) {
	var dropped4xx atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
	}))
	defer srv.Close()
	ob := NewOutbox(OutboxOptions{
		ControlPlaneBaseURL: srv.URL,
		Logger:              quiet(),
		HTTPTimeout:         100 * time.Millisecond,
		FlushEvery:          50 * time.Millisecond,
		MaxRetries:          1,
		Capacity:            10,
		Metrics:             OutboxMetrics{On4xxDrop: func() { dropped4xx.Add(1) }},
	})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	ob.Start(ctx)
	defer ob.Stop()

	ob.Enqueue(DebitEvent{VirtualKeyID: "vk_1", ActualCostUSD: 0.001, Status: "success"})
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) && dropped4xx.Load() < 1 {
		time.Sleep(20 * time.Millisecond)
	}
	if dropped4xx.Load() != 1 {
		t.Errorf("expected exactly 1 4xx-drop hook fire, got %d", dropped4xx.Load())
	}
}

func TestOutboxCapacityAccessor(t *testing.T) {
	ob := NewOutbox(OutboxOptions{
		ControlPlaneBaseURL: "http://unused",
		Logger:              quiet(),
		Capacity:            1234,
	})
	if got := ob.Capacity(); got != 1234 {
		t.Errorf("Capacity()=%d want 1234", got)
	}
}

var _ = errors.New // guard against unused import in future refactors
