package pipeline

import (
	"context"
	"sync"
	"time"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/forkedcontext"
	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// BudgetPrecheckFunc checks whether the request is within budget.
type BudgetPrecheckFunc func(ctx context.Context, bundle *domain.Bundle) (domain.BudgetVerdict, error)

// BudgetDebitFunc records cost after a successful response.
type BudgetDebitFunc func(ctx context.Context, bundle *domain.Bundle, usage domain.Usage)

// Budget creates an interceptor that prechecks budget before dispatch and
// debits cost after a successful response.
func Budget(precheck BudgetPrecheckFunc, debit BudgetDebitFunc, logger *zap.Logger) Interceptor {
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
				resp, err := next(ctx, call)
				if err != nil {
					return nil, err
				}
				usage := resp.Usage
				if usage.Model == "" {
					usage.Model = call.Request.Model
				}
				debit(ctx, call.Bundle, usage)
				return resp, nil
			}
		},
		Stream: func(next StreamFunc) StreamFunc {
			return func(ctx context.Context, call *Call) (domain.StreamIterator, error) {
				if err := pre(ctx, call); err != nil {
					return nil, err
				}
				iter, err := next(ctx, call)
				if err != nil {
					return nil, err
				}
				return &budgetStreamWrapper{
					inner: iter,
					debit: debit,
					bundle: call.Bundle,
					model: call.Request.Model,
				}, nil
			}
		},
	}
}

// budgetStreamWrapper debits budget when the stream closes.
type budgetStreamWrapper struct {
	inner     domain.StreamIterator
	debit     BudgetDebitFunc
	bundle    *domain.Bundle
	model     string
	lastCtx   context.Context
	closeOnce sync.Once
}

func (w *budgetStreamWrapper) Next(ctx context.Context) bool {
	w.lastCtx = ctx
	if !w.inner.Next(ctx) {
		w.onClose()
		return false
	}
	return true
}

func (w *budgetStreamWrapper) Chunk() []byte       { return w.inner.Chunk() }
func (w *budgetStreamWrapper) Usage() domain.Usage { return w.inner.Usage() }
func (w *budgetStreamWrapper) Err() error          { return w.inner.Err() }

func (w *budgetStreamWrapper) Close() error {
	w.onClose()
	return w.inner.Close()
}

func (w *budgetStreamWrapper) onClose() {
	w.closeOnce.Do(func() {
		ctx := w.lastCtx
		if ctx == nil {
			ctx = context.Background()
		}
		forkedcontext.ForkWithTimeout(ctx, 5*time.Second, func(ctx context.Context) error {
			usage := w.inner.Usage()
			if usage.Model == "" {
				usage.Model = w.model
			}
			w.debit(ctx, w.bundle, usage)
			return nil
		})
	})
}
