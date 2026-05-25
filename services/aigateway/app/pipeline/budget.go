package pipeline

import (
	"context"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// BudgetPrecheckFunc checks whether the request is within budget.
type BudgetPrecheckFunc func(ctx context.Context, bundle *domain.Bundle) (domain.BudgetVerdict, error)

// defaultBudgetExceededMessage is the admin-actionable copy shown when an org
// hits its gateway spending limit and hasn't set a custom governance message.
// Avoids credit/billing wording so generic agent clients render it verbatim
// instead of overlaying their own billing UI.
const defaultBudgetExceededMessage = "Your organization's AI gateway spending limit has been reached. Contact your LangWatch admin to raise it."

// budgetExceededMessage prefers the org's configured governance message and
// falls back to the built-in default, so the 402 always carries actionable
// copy instead of a bare error code.
func budgetExceededMessage(cfg domain.BundleConfig) string {
	if msg := cfg.Governance.AccountErrorMessage; msg != "" {
		return msg
	}
	return defaultBudgetExceededMessage
}

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
			return herr.New(ctx, domain.ErrBudgetExceeded, herr.M{
				"message": budgetExceededMessage(call.Bundle.Config),
			})
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
