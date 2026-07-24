// Package budget implements budget precheck on the gateway hot path.
//
// Debits are NOT sent from the gateway. Cost is captured on the OTel span
// emitted by the trace bridge; the control plane's trace-fold reactor
// (langwatch/src/server/event-sourcing/pipelines/trace-processing/reactors/
// gatewayBudgetSync.reactor.ts) writes ClickHouse ledger rows from the
// span attributes. Single source of truth, no PG dual-write.
package budget

import (
	"context"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// Checker implements BudgetChecker with a cached precheck path.
type Checker struct {
	logger *zap.Logger
}

// CheckerOptions configures the budget checker.
type CheckerOptions struct {
	Logger *zap.Logger
}

// NewChecker creates a budget checker.
func NewChecker(opts CheckerOptions) *Checker {
	return &Checker{logger: opts.Logger}
}

// Precheck evaluates cached budget snapshots. Never calls control plane on hot path.
// Permissive by default: stale data allows the request through, debit reconciles later.
func (c *Checker) Precheck(_ context.Context, bundle *domain.Bundle) (domain.BudgetVerdict, error) {
	if len(bundle.Config.Budget.Scopes) == 0 {
		return domain.BudgetAllow, nil
	}

	for _, scope := range bundle.Config.Budget.Scopes {
		if scope.LimitMicroUSD <= 0 {
			continue
		}
		remaining := scope.LimitMicroUSD - scope.SpentMicroUSD
		switch scope.OnBreach {
		case "block":
			if remaining <= 0 {
				return domain.BudgetBlock, nil
			}
		case "warn":
			pctUsed := (scope.SpentMicroUSD * 100) / scope.LimitMicroUSD
			if remaining <= 0 || pctUsed >= 90 {
				return domain.BudgetWarn, nil
			}
		}
	}

	return domain.BudgetAllow, nil
}
