// Package retry implements a generic fallback/retry engine that walks an
// ordered chain of slots, advancing on retryable failures.
package retry

import (
	"context"
	"errors"
	"fmt"
	"time"
)

// Reason classifies why an attempt was abandoned.
type Reason string

const (
	ReasonSuccess        Reason = "success"
	ReasonFallback       Reason = "fallback_success"
	ReasonRetryable5xx   Reason = "retryable_5xx"
	ReasonRateLimit      Reason = "rate_limit"
	ReasonTimeout        Reason = "timeout"
	ReasonNetwork        Reason = "network"
	ReasonCircuitOpen    Reason = "circuit_open"
	ReasonNonRetryable   Reason = "non_retryable"
	ReasonChainExhausted Reason = "chain_exhausted"
	ReasonContextDone    Reason = "context_done"
)

// Attempt is the operation retried across chain slots. Return (result, nil)
// on success, or (zero, err) on failure. The classify function determines
// whether to retry.
type Attempt[R any] func(ctx context.Context, slotID string) (R, error)

// Classifier maps an error to a Reason. Return ReasonNonRetryable to stop.
type Classifier func(err error) Reason

// BreakerChecker reports whether a slot is allowed (circuit closed/half-open).
type BreakerChecker interface {
	Allow(id string) bool
	RecordSuccess(id string)
	RecordFailure(id string)
}

// Event describes one attempt in the chain.
type Event struct {
	Slot       int
	SlotID     string
	Reason     Reason
	Duration   time.Duration
	Err        error
}

// Options configures the retry engine.
type Options struct {
	Triggers          map[Reason]bool  // reasons that trigger retry (default: 5xx, rate_limit, timeout, network)
	MaxAttempts       int              // 0 = walk full chain
	Breaker           BreakerChecker   // optional circuit breaker
	PerAttemptTimeout time.Duration    // 0 = inherit parent ctx
}

func (o *Options) withDefaults() {
	if o.Triggers == nil {
		o.Triggers = map[Reason]bool{
			ReasonRetryable5xx: true,
			ReasonRateLimit:    true,
			ReasonTimeout:      true,
			ReasonNetwork:      true,
		}
	}
}

// Walk executes the attempt across the chain. Returns the first successful
// result, all events, or an error if the chain is exhausted.
func Walk[R any](ctx context.Context, opts Options, chain []string, try Attempt[R], classify Classifier) (R, []Event, error) {
	var zero R
	opts.withDefaults()

	if len(chain) == 0 {
		chain = []string{""}
	}

	var events []Event
	var firstErr error
	attempts := 0

	for i, slotID := range chain {
		if err := ctx.Err(); err != nil {
			events = append(events, Event{Slot: i, SlotID: slotID, Reason: ReasonContextDone, Err: err})
			return zero, events, err
		}
		if slotID != "" && opts.Breaker != nil && !opts.Breaker.Allow(slotID) {
			events = append(events, Event{Slot: i, SlotID: slotID, Reason: ReasonCircuitOpen})
			continue
		}
		if opts.MaxAttempts > 0 && attempts >= opts.MaxAttempts {
			events = append(events, Event{Slot: i, SlotID: slotID, Reason: ReasonChainExhausted})
			break
		}
		attempts++

		attemptCtx := ctx
		var cancel context.CancelFunc
		if opts.PerAttemptTimeout > 0 {
			attemptCtx, cancel = context.WithTimeout(ctx, opts.PerAttemptTimeout)
		}

		start := time.Now()
		result, err := try(attemptCtx, slotID)
		duration := time.Since(start)

		if cancel != nil {
			cancel()
		}

		if err == nil {
			reason := ReasonSuccess
			if i > 0 {
				reason = ReasonFallback
			}
			events = append(events, Event{Slot: i, SlotID: slotID, Reason: reason, Duration: duration})
			if slotID != "" && opts.Breaker != nil {
				opts.Breaker.RecordSuccess(slotID)
			}
			return result, events, nil
		}

		if firstErr == nil {
			firstErr = err
		}

		reason := ReasonNonRetryable
		if classify != nil {
			reason = classify(err)
		}
		events = append(events, Event{Slot: i, SlotID: slotID, Reason: reason, Duration: duration, Err: err})

		if slotID != "" && opts.Breaker != nil {
			opts.Breaker.RecordFailure(slotID)
		}
		if !opts.Triggers[reason] {
			return zero, events, err
		}
	}

	if firstErr == nil {
		firstErr = errors.New("retry chain exhausted with no attempts")
	}
	return zero, events, fmt.Errorf("retry chain exhausted: %w", firstErr)
}
