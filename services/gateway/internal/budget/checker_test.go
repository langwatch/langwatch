package budget

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/langwatch/langwatch/services/gateway/internal/auth"
)

func quietLogger() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

func newTestBundle(scopes ...auth.BudgetSpec) *auth.Bundle {
	return &auth.Bundle{
		JWTClaims: auth.JWTClaims{VirtualKeyID: "vk_01"},
		Config:    &auth.Config{Budgets: scopes},
	}
}

func TestHotScopes_PicksOnlyNearLimit(t *testing.T) {
	c := NewChecker(CheckerOptions{NearLimitPct: 0.9})
	b := newTestBundle(
		auth.BudgetSpec{Scope: "virtual_key", ScopeID: "vk_01", Window: "day", LimitUSD: 10, SpentUSD: 2, OnBreach: "block"},  // cold
		auth.BudgetSpec{Scope: "project", ScopeID: "proj_01", Window: "month", LimitUSD: 100, SpentUSD: 95, OnBreach: "block"}, // hot
		auth.BudgetSpec{Scope: "team", ScopeID: "team_01", Window: "month", LimitUSD: 500, SpentUSD: 100, OnBreach: "warn"},    // cold
	)
	hot := c.HotScopes(b)
	if len(hot) != 1 || hot[0].Scope != "project" {
		t.Fatalf("expected only project scope hot, got %+v", hot)
	}
}

func TestCheckLive_HTTPRoundTrip(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req checkRequest
		_ = json.NewDecoder(r.Body).Decode(&req)
		if req.VirtualKeyID != "vk_01" {
			t.Errorf("unexpected vk_id: %q", req.VirtualKeyID)
		}
		_ = json.NewEncoder(w).Encode(checkResponse{Scopes: []ScopeLive{
			{Scope: "project", ScopeID: "proj_01", Window: "month", SpentUSD: 99.50, LimitUSD: 100},
		}})
	}))
	defer srv.Close()
	c := NewChecker(CheckerOptions{ControlPlaneBaseURL: srv.URL, Logger: quietLogger(), Timeout: time.Second})
	b := newTestBundle(auth.BudgetSpec{Scope: "project", ScopeID: "proj_01", Window: "month", LimitUSD: 100, SpentUSD: 95, OnBreach: "block"})
	res, err := c.CheckLive(context.Background(), b, b.Config.Budgets)
	if err != nil {
		t.Fatal(err)
	}
	v, ok := res[scopeKey("project", "proj_01", "month")]
	if !ok || v.SpentUSD != 99.50 {
		t.Errorf("unexpected live result: %+v", res)
	}
}

func TestApplyLive_BlocksOnReconciliation(t *testing.T) {
	// Cache says spent=95 of 100 — $5 room. Estimate is $3, cached would pass.
	// Live says spent=99.50 — only $0.50 left. A $3 request breaches.
	b := newTestBundle(auth.BudgetSpec{Scope: "project", ScopeID: "proj_01", Window: "month", LimitUSD: 100, SpentUSD: 95, OnBreach: "block"})
	cached := Precheck(b, 3)
	if cached.Decision == DecisionHardStop {
		t.Fatal("precondition: cached should allow")
	}
	live := map[string]ScopeLive{
		scopeKey("project", "proj_01", "month"): {Scope: "project", ScopeID: "proj_01", Window: "month", SpentUSD: 99.50, LimitUSD: 100},
	}
	reconciled := ApplyLive(b, 3, live)
	if reconciled.Decision != DecisionHardStop {
		t.Errorf("expected hard_block after live reconciliation, got %s", reconciled.Decision)
	}
}

func TestApplyLive_AllowsWhenLiveSpentLower(t *testing.T) {
	// Cache shows us near limit (95/100) but live says another node
	// already rolled back / credited — spent is actually 80. Allow.
	b := newTestBundle(auth.BudgetSpec{Scope: "project", ScopeID: "proj_01", Window: "month", LimitUSD: 100, SpentUSD: 95, OnBreach: "block"})
	live := map[string]ScopeLive{
		scopeKey("project", "proj_01", "month"): {Scope: "project", ScopeID: "proj_01", Window: "month", SpentUSD: 80, LimitUSD: 100},
	}
	reconciled := ApplyLive(b, 3, live)
	if reconciled.Decision != DecisionAllow {
		t.Errorf("expected allow after live reconciliation, got %s", reconciled.Decision)
	}
}

func TestCheckLive_TimeoutIsFailOpen(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		time.Sleep(200 * time.Millisecond)
		_ = json.NewEncoder(w).Encode(checkResponse{})
	}))
	defer srv.Close()
	c := NewChecker(CheckerOptions{ControlPlaneBaseURL: srv.URL, Logger: quietLogger(), Timeout: 30 * time.Millisecond})
	b := newTestBundle(auth.BudgetSpec{Scope: "project", ScopeID: "proj_01", Window: "month", LimitUSD: 100, SpentUSD: 95, OnBreach: "block"})
	_, err := c.CheckLive(context.Background(), b, b.Config.Budgets)
	if err == nil {
		t.Fatal("expected timeout error so dispatcher can fall back to cached")
	}
}
