// Package budget implements budget precheck on the gateway hot path.
//
// Debits are NOT sent from the gateway. Cost is captured on the OTel span
// emitted by the trace bridge; the control plane's gateway-budget map
// projection (platform/app/ee/governance/projections/
// gatewayBudgetDebits.mapProjection.ts) writes ClickHouse ledger rows from
// the span attributes, one debit per gateway request. Single source of
// truth, no PG dual-write.
package budget

import (
	"context"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// BlockMetrics counts rejections by the scope whose limit was breached.
// Declared here rather than imported so the checker stays free of a
// metrics dependency; the gateway's Prometheus recorder satisfies it.
type BlockMetrics interface {
	RecordBudgetBlock(scope string)
}

// Checker implements BudgetChecker with a cached precheck path.
type Checker struct {
	logger  *zap.Logger
	metrics BlockMetrics
}

// CheckerOptions configures the budget checker.
type CheckerOptions struct {
	Logger *zap.Logger
	// Metrics counts blocked requests by scope. Optional; nil skips
	// counting.
	Metrics BlockMetrics
}

// NewChecker creates a budget checker.
func NewChecker(opts CheckerOptions) *Checker {
	return &Checker{logger: opts.Logger, metrics: opts.Metrics}
}

// SoftWarnPercent is how much of a budget must be consumed before the gateway
// attaches a warning to the response. It mirrors the control plane's soft-warn
// threshold (platform/app/src/server/gateway/budget.service.ts) so the response
// header, the dashboard banner and the CLI all fire at the same point instead
// of the header staying silent through the whole band the dashboard already
// calls a warning.
const SoftWarnPercent = 80

// Precheck evaluates cached budget snapshots. Never calls control plane on hot path.
// Permissive by default: stale data allows the request through, debit reconciles later.
//
// A scope that is out of budget blocks only when its on_breach is "block";
// every other scope at or past SoftWarnPercent contributes a warning, whatever
// its on_breach. A "warn" scope past its limit is still just a warning, and a
// "block" scope on approach warns before it starts rejecting.
//
// A provider-filtered budget constrains one vendor, not the request (contract
// §4.6): breaching it never blocks here, it EXCLUDES that provider from the
// request's candidate chain, and the dispatcher blocks (naming the budget)
// only when the exclusions leave the chain empty. The exhausted filtered
// budget still contributes its warning, because a request served by another
// provider is exactly when the caller should hear that one vendor's allowance
// ran out. GROUP buckets need no special handling: the bundle materializes
// one bucket per (budget, member) with the key's principal already resolved,
// so each "group" scope row here IS the per-member allowance.
func (c *Checker) Precheck(_ context.Context, bundle *domain.Bundle) (domain.BudgetDecision, error) {
	decision := domain.BudgetDecision{Verdict: domain.BudgetAllow}

	for i := range bundle.Config.Budget.Scopes {
		scope := &bundle.Config.Budget.Scopes[i]
		if scope.LimitMicroUSD <= 0 {
			continue
		}
		exhausted := scope.SpentMicroUSD >= scope.LimitMicroUSD
		if exhausted && scope.OnBreach == "block" {
			if scope.ProviderKey == "" {
				if c.metrics != nil {
					c.metrics.RecordBudgetBlock(scope.Scope)
				}
				blocked := *scope
				return domain.BudgetDecision{
					Verdict:   domain.BudgetBlock,
					BlockedBy: &blocked,
				}, nil
			}
			decision.ExcludedProviders = append(decision.ExcludedProviders, domain.ExcludedProvider{
				ProviderKey: scope.ProviderKey,
				Budget:      *scope,
			})
		}
		pctUsed := int((scope.SpentMicroUSD * 100) / scope.LimitMicroUSD)
		if pctUsed < SoftWarnPercent {
			continue
		}
		decision.Verdict = domain.BudgetWarn
		decision.Warnings = append(decision.Warnings, domain.BudgetWarning{
			Scope:       scope.Scope,
			ProviderKey: scope.ProviderKey,
			PctUsed:     pctUsed,
		})
	}

	return decision, nil
}
