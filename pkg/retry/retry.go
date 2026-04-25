// Package retry implements a generic fallback/retry engine that walks an
// ordered chain of slots, advancing on retryable failures.
package retry

import (
	"context"
	"errors"
	"fmt"
	"sync"
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
	Slot     int
	SlotID   string
	Reason   Reason
	Duration time.Duration
	Err      error
}

// EventLog holds a pooled slice of events from a Walk call. The struct wrapper
// keeps the *EventLog pointer stable through Get/Put — avoids re-allocating a
// pointer on every Release (which defeats the pool). Call Release when done.
type EventLog struct {
	events []Event
}

// Events returns the recorded events.
func (el *EventLog) Events() []Event {
	if el == nil {
		return nil
	}
	return el.events
}

// Release returns the backing memory to the pool. The EventLog must not be
// used after calling Release.
func (el *EventLog) Release() {
	if el == nil {
		return
	}
	for i := range el.events {
		el.events[i] = Event{}
	}
	el.events = el.events[:0]
	eventsPool.Put(el)
}

var eventsPool = sync.Pool{
	New: func() any {
		return &EventLog{events: make([]Event, 0, 4)}
	},
}

// defaultTriggers is a package-level read-only map so withDefaults() doesn't
// allocate a new map on every Walk call.
var defaultTriggers = map[Reason]bool{
	ReasonRetryable5xx: true,
	ReasonRateLimit:    true,
	ReasonTimeout:      true,
	ReasonNetwork:      true,
}

// Options configures the retry engine.
type Options struct {
	Triggers          map[Reason]bool // reasons that trigger retry (default: 5xx, rate_limit, timeout, network)
	MaxAttempts       int             // 0 = walk full chain
	Breaker           BreakerChecker  // optional circuit breaker
	PerAttemptTimeout time.Duration   // 0 = inherit parent ctx
}

func (o *Options) withDefaults() {
	if o.Triggers == nil {
		o.Triggers = defaultTriggers
	}
}

// Walk executes the attempt across the chain. Returns the first successful
// result, an EventLog (call Release when done), or an error if the chain is
// exhausted.
func Walk[R any](ctx context.Context, opts Options, chain []string, try Attempt[R], classify Classifier) (R, *EventLog, error) {
	var zero R
	opts.withDefaults()

	if len(chain) == 0 {
		chain = []string{""}
	}

	el := eventsPool.Get().(*EventLog)
	var firstErr error
	attempts := 0

	for i, slotID := range chain {
		if err := ctx.Err(); err != nil {
			el.events = append(el.events, Event{Slot: i, SlotID: slotID, Reason: ReasonContextDone, Err: err})
			return zero, el, err
		}
		if slotID != "" && opts.Breaker != nil && !opts.Breaker.Allow(slotID) {
			el.events = append(el.events, Event{Slot: i, SlotID: slotID, Reason: ReasonCircuitOpen})
			continue
		}
		if opts.MaxAttempts > 0 && attempts >= opts.MaxAttempts {
			el.events = append(el.events, Event{Slot: i, SlotID: slotID, Reason: ReasonChainExhausted})
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
			el.events = append(el.events, Event{Slot: i, SlotID: slotID, Reason: reason, Duration: duration})
			if slotID != "" && opts.Breaker != nil {
				opts.Breaker.RecordSuccess(slotID)
			}
			return result, el, nil
		}

		if firstErr == nil {
			firstErr = err
		}

		reason := ReasonNonRetryable
		if classify != nil {
			reason = classify(err)
		}
		el.events = append(el.events, Event{Slot: i, SlotID: slotID, Reason: reason, Duration: duration, Err: err})

		if slotID != "" && opts.Breaker != nil {
			opts.Breaker.RecordFailure(slotID)
		}
		if !opts.Triggers[reason] {
			return zero, el, err
		}
	}

	if firstErr == nil {
		firstErr = errors.New("retry chain exhausted with no attempts")
	}
	return zero, el, fmt.Errorf("retry chain exhausted: %w", firstErr)
}
