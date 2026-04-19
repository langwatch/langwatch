// Package budget implements the gateway-side budget logic:
//
//   - Precheck runs on the hot path against the cached budget snapshot
//     embedded in each VK config.Bundles it with a cost estimate so we
//     short-circuit (402 budget_exceeded) without touching the control
//     plane.
//
//   - Debit is a fire-and-forget outbox. Every completed request pushes a
//     DebitEvent into an in-process ring buffer; a background flusher
//     POSTs batches to POST /api/internal/gateway/budget/debit with
//     at-least-once retry, idempotent via ULID gateway_request_id. The
//     response is never in the hot path of the user request.
//
// Contract: §4.4 (budget/check), §4.5 (budget/debit outbox).
package budget

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/oklog/ulid/v2"

	"github.com/langwatch/langwatch/services/gateway/internal/auth"
)

// PrecheckResult is what the dispatcher uses to decide whether to hit the
// upstream provider. Block = return 402 now; Warn = attach a header and
// proceed; Allow = proceed silently.
type PrecheckResult struct {
	Decision Decision
	Reason   string
	Warnings []Warning
}

type Decision string

const (
	DecisionAllow    Decision = "allow"
	DecisionSoftWarn Decision = "soft_warn"
	DecisionHardStop Decision = "hard_block"
)

type Warning struct {
	Scope   string  `json:"scope"`
	PctUsed float64 `json:"pct_used"`
}

// Precheck evaluates every budget scope on the cached bundle. It does not
// talk to the control plane — the snapshot is refreshed via the config
// long-poll path. A precheck mis-estimate at worst causes the request to
// pass and debit later reconciles; we choose permissive over blocking on
// stale data.
//
// estimatedCostUSD is a provider-aware cost estimate computed by the
// dispatcher from input tokens + model's per-1k pricing. Pass 0 when the
// estimate is unavailable and the precheck will use current spent vs
// limit only.
func Precheck(b *auth.Bundle, estimatedCostUSD float64) PrecheckResult {
	if b == nil || b.Config == nil {
		return PrecheckResult{Decision: DecisionAllow}
	}
	var warnings []Warning
	hardBlock := ""
	for _, s := range b.Config.Budgets {
		// Remaining before the new call.
		remaining := s.LimitUSD - s.SpentUSD
		// Projected remaining after the estimate.
		projRemaining := remaining - estimatedCostUSD
		pctUsed := 0.0
		if s.LimitUSD > 0 {
			pctUsed = (s.SpentUSD / s.LimitUSD) * 100
		}

		switch s.OnBreach {
		case "block":
			if projRemaining < 0 {
				hardBlock = fmt.Sprintf("budget exceeded scope=%s window=%s remaining=%.4f required~=%.4f",
					s.Scope, s.Window, remaining, estimatedCostUSD)
			}
		case "warn":
			if projRemaining < 0 || pctUsed >= 90 {
				warnings = append(warnings, Warning{Scope: s.Scope, PctUsed: pctUsed})
			}
		}
	}
	if hardBlock != "" {
		return PrecheckResult{Decision: DecisionHardStop, Reason: hardBlock, Warnings: warnings}
	}
	if len(warnings) > 0 {
		return PrecheckResult{Decision: DecisionSoftWarn, Warnings: warnings}
	}
	return PrecheckResult{Decision: DecisionAllow}
}

// --- Outbox -----------------------------------------------------------------

// DebitEvent is the shape posted to /api/internal/gateway/budget/debit.
// See contract §4.5.
type DebitEvent struct {
	GatewayRequestID string  `json:"gateway_request_id"` // ULID — idempotency key
	VirtualKeyID     string  `json:"vk_id"`
	ActualCostUSD    float64 `json:"actual_cost_usd"`
	Tokens           Tokens  `json:"tokens"`
	Model            string  `json:"model"`
	ProviderSlot     string  `json:"provider_slot"`
	DurationMS       int64   `json:"duration_ms"`
	Status           string  `json:"status"` // success | provider_error | blocked_by_guardrail | cancelled
}

type Tokens struct {
	Input      int `json:"input"`
	Output     int `json:"output"`
	CacheRead  int `json:"cache_read,omitempty"`
	CacheWrite int `json:"cache_write,omitempty"`
}

// Signer signs outbound internal HTTP calls with the HMAC scheme shared
// with the control plane (contract §4.0). We accept a function so budget
// and guardrails both plug into the same auth code without circular
// imports.
type Signer func(req *http.Request, body []byte)

// Outbox batches DebitEvents and flushes on an interval. Capacity is
// bounded; if the caller overwhelms the outbox (control-plane offline
// for a very long time), the oldest events are dropped and a counter
// ticks. Dropped events are logged with `budget_outbox_dropped` so
// operators can see the backlog.
type Outbox struct {
	endpoint   string
	http       *http.Client
	sign       Signer
	logger     *slog.Logger
	flushEvery time.Duration
	maxRetries int
	cap        int
	metrics    OutboxMetrics

	mu      sync.Mutex
	buf     []DebitEvent
	dropped int

	wake chan struct{}
	stop chan struct{}
	done chan struct{}
}

// OutboxMetrics is a narrow callback hook so package budget does not
// depend on package metrics. All fields optional — a nil callback is a
// no-op. The callbacks fire on the same goroutine that triggered the
// event, so implementations must not block.
type OutboxMetrics struct {
	// OnCapacityDrop fires once per event displaced when the ring
	// buffer is at cap. Reading side ticks a paging counter.
	OnCapacityDrop func()
	// OnFlushFailure fires when a batch flush exhausted retries /
	// hit a transport error that got the batch re-enqueued. Signals
	// the control plane is unreachable or slow, not that we lost data.
	OnFlushFailure func()
	// On4xxDrop fires when the control plane returned a 4xx (non-429)
	// and we dropped the event rather than retry forever. Signals a
	// signing / payload bug — non-zero rate is a page.
	On4xxDrop func()
}

type OutboxOptions struct {
	ControlPlaneBaseURL string
	Sign                Signer
	Logger              *slog.Logger
	HTTPTimeout         time.Duration
	FlushEvery          time.Duration
	MaxRetries          int
	Capacity            int
	Metrics             OutboxMetrics
}

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
	if opts.HTTPTimeout == 0 {
		opts.HTTPTimeout = 2 * time.Second
	}
	return &Outbox{
		endpoint:   opts.ControlPlaneBaseURL + "/api/internal/gateway/budget/debit",
		http:       &http.Client{Timeout: opts.HTTPTimeout},
		sign:       opts.Sign,
		logger:     opts.Logger,
		flushEvery: opts.FlushEvery,
		maxRetries: opts.MaxRetries,
		cap:        opts.Capacity,
		metrics:    opts.Metrics,
		buf:        make([]DebitEvent, 0, 1024),
		wake:       make(chan struct{}, 1),
		stop:       make(chan struct{}),
		done:       make(chan struct{}),
	}
}

// Capacity returns the configured maximum buffer depth. Exposed so
// operators can surface it as a gauge alongside depth.
func (o *Outbox) Capacity() int { return o.cap }

// Start launches the flusher goroutine. Blocks on ctx cancellation or
// Stop call. Safe to call exactly once.
func (o *Outbox) Start(ctx context.Context) {
	go o.run(ctx)
}

// Stop signals the flusher, waits up to 5s for final drain.
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

// Enqueue pushes a DebitEvent onto the outbox. Never blocks.
// If the outbox is at capacity, the oldest event is dropped and the
// dropped counter ticks. A missing GatewayRequestID is auto-assigned a
// ULID so idempotency is always well-defined.
func (o *Outbox) Enqueue(ev DebitEvent) {
	if ev.GatewayRequestID == "" {
		ev.GatewayRequestID = newULID()
	}
	o.mu.Lock()
	dropped := false
	if len(o.buf) >= o.cap {
		o.buf = o.buf[1:]
		o.dropped++
		dropped = true
	}
	o.buf = append(o.buf, ev)
	o.mu.Unlock()
	if dropped && o.metrics.OnCapacityDrop != nil {
		o.metrics.OnCapacityDrop()
	}
	// Non-blocking wake.
	select {
	case o.wake <- struct{}{}:
	default:
	}
}

// Stats reports current outbox depth and drop count — useful for metrics
// and /readyz reporting.
func (o *Outbox) Stats() (depth, dropped int) {
	o.mu.Lock()
	defer o.mu.Unlock()
	return len(o.buf), o.dropped
}

// Depth is a lightweight metric-friendly accessor for the current
// buffer depth only. Pairs with gateway_budget_debit_outbox_depth.
func (o *Outbox) Depth() int {
	o.mu.Lock()
	defer o.mu.Unlock()
	return len(o.buf)
}

func (o *Outbox) run(ctx context.Context) {
	defer close(o.done)
	t := time.NewTicker(o.flushEvery)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			o.flushAll(context.Background())
			return
		case <-o.stop:
			o.flushAll(context.Background())
			return
		case <-t.C:
			o.flushAll(ctx)
		case <-o.wake:
			// Drain under the next tick; wake is just a hurry-up signal.
		}
	}
}

func (o *Outbox) flushAll(ctx context.Context) {
	batch := o.drain()
	if len(batch) == 0 {
		return
	}
	for _, ev := range batch {
		if err := o.flushOne(ctx, ev); err != nil {
			// Push it back to the front for the next tick; we preserve
			// ordering by re-enqueuing at the head. Under pathological
			// control-plane outage we'll eventually hit the drop cap
			// and log it.
			o.mu.Lock()
			o.buf = append([]DebitEvent{ev}, o.buf...)
			dropped := false
			if len(o.buf) > o.cap {
				o.buf = o.buf[:o.cap]
				o.dropped++
				dropped = true
			}
			o.mu.Unlock()
			if o.metrics.OnFlushFailure != nil {
				o.metrics.OnFlushFailure()
			}
			if dropped && o.metrics.OnCapacityDrop != nil {
				o.metrics.OnCapacityDrop()
			}
			o.logger.Debug("budget_debit_retry", "gateway_request_id", ev.GatewayRequestID, "err", err)
			return // stop the batch; next tick retries
		}
	}
}

func (o *Outbox) drain() []DebitEvent {
	o.mu.Lock()
	defer o.mu.Unlock()
	if len(o.buf) == 0 {
		return nil
	}
	batch := o.buf
	o.buf = make([]DebitEvent, 0, 1024)
	return batch
}

func (o *Outbox) flushOne(ctx context.Context, ev DebitEvent) error {
	body, err := json.Marshal(ev)
	if err != nil {
		return fmt.Errorf("marshal debit: %w", err)
	}
	for attempt := 0; attempt < o.maxRetries; attempt++ {
		req, err := http.NewRequestWithContext(ctx, "POST", o.endpoint, bytes.NewReader(body))
		if err != nil {
			return err
		}
		req.Header.Set("Content-Type", "application/json")
		if o.sign != nil {
			o.sign(req, body)
		}
		resp, err := o.http.Do(req)
		if err != nil {
			// Transport error — retry with backoff.
			if attempt < o.maxRetries-1 {
				sleepBackoff(attempt)
				continue
			}
			return fmt.Errorf("debit transport after %d attempts: %w", attempt+1, err)
		}
		_, _ = io.Copy(io.Discard, resp.Body)
		resp.Body.Close()
		switch {
		case resp.StatusCode >= 200 && resp.StatusCode < 300:
			return nil
		case resp.StatusCode >= 500 || resp.StatusCode == http.StatusTooManyRequests:
			if attempt < o.maxRetries-1 {
				sleepBackoff(attempt)
				continue
			}
			return fmt.Errorf("debit upstream %d after %d attempts", resp.StatusCode, attempt+1)
		default:
			// 4xx (except 429): caller mis-signed or bad payload. Drop
			// the event rather than loop forever; log for debugging.
			o.logger.Warn("budget_debit_4xx_drop",
				"gateway_request_id", ev.GatewayRequestID,
				"status", resp.StatusCode)
			if o.metrics.On4xxDrop != nil {
				o.metrics.On4xxDrop()
			}
			return nil
		}
	}
	return errors.New("debit retries exhausted")
}

func sleepBackoff(attempt int) {
	// 100ms * 2^attempt up to 10s. Deterministic; a noisy neighbor
	// retrying in lockstep is fine since we dedupe on ID server-side.
	d := time.Duration(100*(1<<attempt)) * time.Millisecond
	if d > 10*time.Second {
		d = 10 * time.Second
	}
	time.Sleep(d)
}

// NewULID returns a fresh ULID for a gateway_request_id. Exposed so the
// dispatcher can mint the id *before* calling the provider (so the id is
// the same across the debit outbox and the response header echoed to
// the client).
func NewULID() string { return newULID() }

func newULID() string {
	return ulid.Make().String()
}
