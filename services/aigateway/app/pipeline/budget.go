package pipeline

import (
	"context"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// BudgetPrecheckFunc checks whether the request is within budget.
type BudgetPrecheckFunc func(ctx context.Context, bundle *domain.Bundle) (domain.BudgetVerdict, error)

// Budget creates an interceptor that prechecks budget before dispatch.
// Cost recording is NOT done here — the trace-fold reactor on the control
// plane folds OTel span usage attributes into the ClickHouse budget ledger.
func Budget(precheck BudgetPrecheckFunc, logger *zap.Logger) Interceptor {
	pre := func(ctx context.Context, call *Call) error {
		verdict, err := precheck(ctx, call.Bundle)
		if err != nil {
			logger.Warn("budget_precheck_error", zap.Error(err))
			return nil
		}
		switch verdict {
		case domain.BudgetAllow:
			// No action needed.
		case domain.BudgetBlock:
			return herr.New(ctx, domain.ErrBudgetExceeded, nil)
		case domain.BudgetWarn:
			call.Meta.BudgetWarnings = append(call.Meta.BudgetWarnings, "near_limit")
		}
		return nil
	}

	return Interceptor{
		Name: "budget",
		Sync: func(next DispatchFunc) DispatchFunc {
			return func(ctx context.Context, call *Call) (*domain.Response, error) {
				if err := pre(ctx, call); err != nil {
					return nil, err
				}
				return next(ctx, call)
			}
		},
		Stream: func(next StreamFunc) StreamFunc {
			return func(ctx context.Context, call *Call) (domain.StreamIterator, error) {
				if err := pre(ctx, call); err != nil {
					return nil, err
				}
				return next(ctx, call)
			}
		},
	}
}
