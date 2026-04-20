// Package budget implements budget precheck and debit outbox.
// Implements app.BudgetChecker.
package budgetctl

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sync"
	"time"

	"github.com/oklog/ulid/v2"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/services/aigateway/app"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// Checker implements app.BudgetChecker with a precheck + fire-and-forget outbox.
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
func (c *Checker) Precheck(_ context.Context, bundle *domain.Bundle) (app.BudgetVerdict, error) {
	if len(bundle.Config.Budget.Scopes) == 0 {
		return app.BudgetAllow, nil
	}

	for _, scope := range bundle.Config.Budget.Scopes {
		if scope.LimitUSD <= 0 {
			continue
		}
		remaining := scope.LimitUSD - scope.SpentUSD
		switch scope.OnBreach {
		case "block":
			if remaining <= 0 {
				return app.BudgetBlock, nil
			}
		case "warn":
			pctUsed := (scope.SpentUSD / scope.LimitUSD) * 100
			if remaining <= 0 || pctUsed >= 90 {
				return app.BudgetWarn, nil
			}
		}
	}

	return app.BudgetAllow, nil
}

// Debit fires a debit event into the outbox.
func (c *Checker) Debit(_ context.Context, bundle *domain.Bundle, usage domain.Usage) {
	if c.outbox == nil {
		return
	}
	c.outbox.Enqueue(DebitEvent{
		GatewayRequestID: NewULID(),
		VirtualKeyID:     bundle.VirtualKeyID,
		CostUSD:          usage.CostUSD,
		PromptTokens:     usage.PromptTokens,
		CompletionTokens: usage.CompletionTokens,
	})
}

// --- Outbox ---

// DebitEvent is posted to the control plane.
type DebitEvent struct {
	GatewayRequestID string  `json:"gateway_request_id"`
	VirtualKeyID     string  `json:"vk_id"`
	CostUSD          float64 `json:"actual_cost_usd"`
	PromptTokens     int     `json:"prompt_tokens"`
	CompletionTokens int     `json:"completion_tokens"`
	Model            string  `json:"model,omitempty"`
}

// Signer signs outbound internal HTTP calls.
type Signer func(req *http.Request, body []byte)

// OutboxOptions configures the outbox.
type OutboxOptions struct {
	Endpoint   string
	Sign       Signer
	Logger     *zap.Logger
	FlushEvery time.Duration
	MaxRetries int
	Capacity   int
}

// Outbox batches debit events and flushes to the control plane.
type Outbox struct {
	endpoint   string
	client     *http.Client
	sign       Signer
	logger     *zap.Logger
	flushEvery time.Duration
	maxRetries int
	cap        int

	mu   sync.Mutex
	buf  []DebitEvent
	wake chan struct{}
	stop chan struct{}
	done chan struct{}
}

// NewOutbox creates a debit outbox.
func NewOutbox(opts OutboxOptions) *Outbox {
	if opts.FlushEvery == 0 {
		opts.FlushEvery = 2 * time.Second
	}
	if opts.MaxRetries == 0 {
		opts.MaxRetries = 10
	}
	if opts.Capacity == 0 {
		opts.Capacity = 10000
	}
	return &Outbox{
		endpoint:   opts.Endpoint,
		client:     &http.Client{Timeout: 2 * time.Second},
		sign:       opts.Sign,
		logger:     opts.Logger,
		flushEvery: opts.FlushEvery,
		maxRetries: opts.MaxRetries,
		cap:        opts.Capacity,
		buf:        make([]DebitEvent, 0, 1024),
		wake:       make(chan struct{}, 1),
		stop:       make(chan struct{}),
		done:       make(chan struct{}),
	}
}

// Enqueue adds an event. Never blocks. Drops oldest on overflow.
func (o *Outbox) Enqueue(ev DebitEvent) {
	o.mu.Lock()
	if len(o.buf) >= o.cap {
		o.buf = o.buf[1:]
	}
	o.buf = append(o.buf, ev)
	o.mu.Unlock()
	select {
	case o.wake <- struct{}{}:
	default:
	}
}

// Depth returns current buffer depth.
func (o *Outbox) Depth() int {
	o.mu.Lock()
	defer o.mu.Unlock()
	return len(o.buf)
}

// Start launches the flusher goroutine.
func (o *Outbox) Start(ctx context.Context) {
	go o.run(ctx)
}

// Stop signals shutdown and waits for drain.
func (o *Outbox) Stop() {
	select {
	case <-o.stop:
		return
	default:
		close(o.stop)
	}
	select {
	case <-o.done:
	case <-time.After(5 * time.Second):
	}
}

func (o *Outbox) run(ctx context.Context) {
	defer close(o.done)
	t := time.NewTicker(o.flushEvery)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			o.flush(context.Background())
			return
		case <-o.stop:
			o.flush(context.Background())
			return
		case <-t.C:
			o.flush(ctx)
		case <-o.wake:
		}
	}
}

func (o *Outbox) flush(ctx context.Context) {
	o.mu.Lock()
	if len(o.buf) == 0 {
		o.mu.Unlock()
		return
	}
	batch := o.buf
	o.buf = make([]DebitEvent, 0, 1024)
	o.mu.Unlock()

	for _, ev := range batch {
		if err := o.send(ctx, ev); err != nil {
			o.logger.Debug("budget_debit_retry", zap.String("id", ev.GatewayRequestID), zap.Error(err))
			// Re-enqueue failed event
			o.mu.Lock()
			o.buf = append([]DebitEvent{ev}, o.buf...)
			if len(o.buf) > o.cap {
				o.buf = o.buf[:o.cap]
			}
			o.mu.Unlock()
			return
		}
	}
}

func (o *Outbox) send(ctx context.Context, ev DebitEvent) error {
	body, err := json.Marshal(ev)
	if err != nil {
		return err
	}
	for attempt := range o.maxRetries {
		req, reqErr := http.NewRequestWithContext(ctx, "POST", o.endpoint, bytes.NewReader(body))
		if reqErr != nil {
			return reqErr
		}
		req.Header.Set("Content-Type", "application/json")
		if o.sign != nil {
			o.sign(req, body)
		}
		resp, doErr := o.client.Do(req)
		if doErr != nil {
			if attempt < o.maxRetries-1 {
				backoff(attempt)
				continue
			}
			return fmt.Errorf("debit transport after %d attempts: %w", attempt+1, doErr)
		}
		_, _ = io.Copy(io.Discard, resp.Body)
		resp.Body.Close()
		if resp.StatusCode >= 200 && resp.StatusCode < 300 {
			return nil
		}
		if resp.StatusCode >= 500 || resp.StatusCode == http.StatusTooManyRequests {
			if attempt < o.maxRetries-1 {
				backoff(attempt)
				continue
			}
			return fmt.Errorf("debit %d after %d attempts", resp.StatusCode, attempt+1)
		}
		// 4xx: drop
		o.logger.Warn("budget_debit_4xx_drop", zap.String("id", ev.GatewayRequestID), zap.Int("status", resp.StatusCode))
		return nil
	}
	return errors.New("debit retries exhausted")
}

func backoff(attempt int) {
	d := time.Duration(100*(1<<attempt)) * time.Millisecond
	if d > 10*time.Second {
		d = 10 * time.Second
	}
	time.Sleep(d)
}

// NewULID generates a fresh ULID string.
func NewULID() string {
	return ulid.Make().String()
}
