// Package budget implements budget precheck and debit delivery.
package budget

import (
	"context"
	"time"

	"github.com/oklog/ulid/v2"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/services/aigateway/adapters/controlplane"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// Checker implements BudgetChecker with a precheck + fire-and-forget outbox.
type Checker struct {
	outbox *Outbox
	logger *zap.Logger
}

// CheckerOptions configures the budget checker.
type CheckerOptions struct {
	Outbox *Outbox
	Logger *zap.Logger
}

// NewChecker creates a budget checker.
func NewChecker(opts CheckerOptions) *Checker {
	return &Checker{outbox: opts.Outbox, logger: opts.Logger}
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

// Debit fires a debit event into the outbox.
func (c *Checker) Debit(_ context.Context, bundle *domain.Bundle, usage domain.Usage) {
	if c.outbox == nil {
		return
	}
	c.outbox.Enqueue(controlplane.DebitEvent{
		GatewayRequestID: newULID(),
		VirtualKeyID:     bundle.VirtualKeyID,
		CostMicroUSD:     usage.CostMicroUSD,
		PromptTokens:     usage.PromptTokens,
		CompletionTokens: usage.CompletionTokens,
	})
}

// DebitPoster sends a debit event to the control plane.
type DebitPoster interface {
	PostDebit(ctx context.Context, ev controlplane.DebitEvent) error
}

// OutboxOptions configures the outbox.
type OutboxOptions struct {
	Poster     DebitPoster
	Logger     *zap.Logger
	MaxRetries int
	Capacity   int
}

// Outbox delivers debit events via a background worker with retry.
type Outbox struct {
	poster     DebitPoster
	logger     *zap.Logger
	maxRetries int

	ch   chan controlplane.DebitEvent
	stop chan struct{}
	done chan struct{}
}

// NewOutbox creates a debit outbox.
func NewOutbox(opts OutboxOptions) *Outbox {
	if opts.MaxRetries == 0 {
		opts.MaxRetries = 5
	}
	if opts.Capacity == 0 {
		opts.Capacity = 10000
	}
	return &Outbox{
		poster:     opts.Poster,
		logger:     opts.Logger,
		maxRetries: opts.MaxRetries,
		ch:         make(chan controlplane.DebitEvent, opts.Capacity),
		stop:       make(chan struct{}),
		done:       make(chan struct{}),
	}
}

// Enqueue adds an event. Never blocks. Drops newest on overflow (back-pressure).
func (o *Outbox) Enqueue(ev controlplane.DebitEvent) {
	select {
	case o.ch <- ev:
	default:
		o.logger.Debug("budget_debit_dropped", zap.String("id", ev.GatewayRequestID))
	}
}

// Depth returns current buffer depth.
func (o *Outbox) Depth() int {
	return len(o.ch)
}

// Start launches the worker goroutine.
func (o *Outbox) Start(_ context.Context) {
	go o.run()
}

// Stop signals shutdown and waits for drain.
func (o *Outbox) Stop() {
	close(o.stop)
	select {
	case <-o.done:
	case <-time.After(5 * time.Second):
	}
}

func (o *Outbox) run() {
	defer close(o.done)
	for {
		select {
		case ev := <-o.ch:
			o.sendWithRetry(ev)
		case <-o.stop:
			o.drain()
			return
		}
	}
}

func (o *Outbox) drain() {
	for {
		select {
		case ev := <-o.ch:
			o.sendWithRetry(ev)
		default:
			return
		}
	}
}

func (o *Outbox) sendWithRetry(ev controlplane.DebitEvent) {
	for attempt := range o.maxRetries {
		err := o.poster.PostDebit(context.Background(), ev)
		if err == nil {
			return
		}
		if attempt < o.maxRetries-1 {
			backoff(attempt)
			continue
		}
		o.logger.Debug("budget_debit_failed", zap.String("id", ev.GatewayRequestID), zap.Error(err))
	}
}

func backoff(attempt int) {
	d := min(time.Duration(100*(1<<attempt))*time.Millisecond, 10*time.Second)
	time.Sleep(d)
}

func newULID() string {
	return ulid.Make().String()
}
