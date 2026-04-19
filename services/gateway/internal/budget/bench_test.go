package budget

import (
	"testing"

	"github.com/langwatch/langwatch/services/gateway/internal/auth"
)

// BenchmarkPrecheck measures the cached precheck path — runs on every
// inbound /v1 request before bifrost is even called. Must be
// nanosecond-level; the dispatcher budgets ~100μs for the whole
// pre-bifrost chain.
func BenchmarkPrecheck(b *testing.B) {
	bundle := &auth.Bundle{
		Config: &auth.Config{
			Budgets: []auth.BudgetSpec{
				{Scope: "virtual_key", ScopeID: "vk_01", Window: "day", LimitUSD: 25, SpentUSD: 12.50, OnBreach: "block"},
				{Scope: "project", ScopeID: "proj_01", Window: "month", LimitUSD: 1000, SpentUSD: 437.55, OnBreach: "block"},
				{Scope: "team", ScopeID: "team_01", Window: "month", LimitUSD: 5000, SpentUSD: 3210, OnBreach: "warn"},
			},
		},
	}
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_ = Precheck(bundle, 0.00042)
	}
}

// BenchmarkPrecheck_HardStop measures the short-circuit case (any
// hard-cap scope breached). Same cost as allow — no shortcut because
// we still enumerate all scopes to collect warnings.
func BenchmarkPrecheck_HardStop(b *testing.B) {
	bundle := &auth.Bundle{
		Config: &auth.Config{
			Budgets: []auth.BudgetSpec{
				{Scope: "virtual_key", ScopeID: "vk_01", Window: "day", LimitUSD: 25, SpentUSD: 25.01, OnBreach: "block"},
			},
		},
	}
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_ = Precheck(bundle, 0.01)
	}
}

// BenchmarkNewULID is the idempotency-key generator used per request.
func BenchmarkNewULID(b *testing.B) {
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_ = NewULID()
	}
}
