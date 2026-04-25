package budget

import (
	"context"
	"testing"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// BenchmarkPrecheck measures the cached precheck path — runs on every
// inbound /v1 request before dispatch. Must be nanosecond-level.
func BenchmarkPrecheck(b *testing.B) {
	checker := NewChecker(CheckerOptions{Logger: nil})
	bundle := &domain.Bundle{
		Config: domain.BundleConfig{
			Budget: domain.BudgetConfig{
				Scopes: []domain.BudgetScope{
					{Scope: "virtual_key", Window: "day", LimitMicroUSD: 25_000_000, SpentMicroUSD: 12_500_000, OnBreach: "block"},
					{Scope: "project", Window: "month", LimitMicroUSD: 1_000_000_000, SpentMicroUSD: 437_550_000, OnBreach: "block"},
					{Scope: "team", Window: "month", LimitMicroUSD: 5_000_000_000, SpentMicroUSD: 3_210_000_000, OnBreach: "warn"},
				},
			},
		},
	}
	ctx := context.Background()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_, _ = checker.Precheck(ctx, bundle)
	}
}

// BenchmarkPrecheck_HardStop measures the short-circuit case (any
// hard-cap scope breached).
func BenchmarkPrecheck_HardStop(b *testing.B) {
	checker := NewChecker(CheckerOptions{Logger: nil})
	bundle := &domain.Bundle{
		Config: domain.BundleConfig{
			Budget: domain.BudgetConfig{
				Scopes: []domain.BudgetScope{
					{Scope: "virtual_key", Window: "day", LimitMicroUSD: 25_000_000, SpentMicroUSD: 25_010_000, OnBreach: "block"},
				},
			},
		},
	}
	ctx := context.Background()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_, _ = checker.Precheck(ctx, bundle)
	}
}

