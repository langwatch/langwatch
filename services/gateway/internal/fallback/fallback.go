// Package fallback walks a VK's fallback chain when the primary
// provider fails with a retryable error. Wire-level behaviour is
// locked in specs/ai-gateway/fallback.feature; this package implements
// it.
//
// The core contract:
//
//   - On 5xx / timeout / rate_limit / network the gateway tries the
//     NEXT provider credential in `fallback.chain`, using the same
//     request payload (bifrost translates between provider wire
//     formats).
//   - 4xx client errors DO NOT trigger fallback (400 bad_request, 401
//     provider_auth_failed, 403 permission_denied, 404 not_found
//     return as-is — the client fixes their request, we don't mask it
//     behind a wrong-answer retry).
//   - A circuit breaker per credential skips slots that have been
//     consistently failing so we don't pay the timeout cost of a dead
//     provider on every request.
//   - Streaming: the caller is responsible for calling fallback only
//     pre-first-chunk. Post-first-chunk behaviour is "terminate with
//     terminal error event, never silent-switch" — enforced in the
//     streaming handler, not here.
//
// This package does NOT know about bifrost. It takes an Attempt
// function and calls it once per chain slot, deciding when to stop.
package fallback

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/langwatch/langwatch/services/gateway/internal/auth"
	"github.com/langwatch/langwatch/services/gateway/internal/circuit"
)

// Reason classifies why a particular attempt was abandoned.
type Reason string

const (
	ReasonPrimarySuccess Reason = "primary_success"
	ReasonFallbackSuccess Reason = "fallback_success"
	ReasonRetryable5xx    Reason = "retryable_5xx"
	ReasonRetryable429    Reason = "rate_limit"
	ReasonRetryableTimeout Reason = "timeout"
	ReasonRetryableNetwork Reason = "network"
	ReasonCircuitOpen     Reason = "circuit_open"
	ReasonNonRetryable    Reason = "non_retryable"
	ReasonChainExhausted  Reason = "chain_exhausted"
	ReasonContextCancel   Reason = "context_cancelled"
)

// Attempt is the operation the engine retries across chain slots.
// credentialID is the provider credential ID to use for this attempt
// (empty means "whatever Bifrost's Account returns"). On success
// return (result, nil, false). On retryable failure, return
// (zero, err, true). On non-retryable, return (zero, err, false) —
// the engine stops walking the chain.
type Attempt[R any] func(ctx context.Context, credentialID string) (R, error, bool)

// Event describes one attempt in the chain. Engine appends an Event
// for every slot it touches (success or otherwise) so callers can
// emit metrics / OTel spans / response headers.
type Event struct {
	Slot       int
	Credential string
	Reason     Reason
	DurationMS int64
	Err        error
}

// Options configures the engine.
type Options struct {
	// Triggers is the set of reason codes that make the engine
	// advance to the next slot. If empty, defaults to the contract
	// set: 5xx + rate_limit + timeout + network.
	Triggers map[Reason]bool
	// MaxAttempts caps the number of slots we'll try (primary + N-1
	// fallbacks). 0 = walk the full chain.
	MaxAttempts int
	// Breakers is the circuit-breaker registry. Slots with an open
	// breaker are skipped without calling the attempt fn.
	Breakers *circuit.Registry
	// PerAttemptTimeout bounds each slot. 0 = inherit parent ctx.
	PerAttemptTimeout time.Duration
}

// Engine walks the chain, one slot at a time.
type Engine struct {
	opts Options
}

// New builds an engine.
func New(opts Options) *Engine {
	if opts.Triggers == nil {
		opts.Triggers = map[Reason]bool{
			ReasonRetryable5xx:     true,
			ReasonRetryable429:     true,
			ReasonRetryableTimeout: true,
			ReasonRetryableNetwork: true,
		}
	}
	return &Engine{opts: opts}
}

// Walk executes the chain. `chain` is the ordered list of credential
// IDs (contract §4.2 `fallback.chain`; primary first). Returns the
// successful result, the list of attempt events (at least one entry),
// or (zero, events, err) when the whole chain failed.
func Walk[R any](ctx context.Context, eng *Engine, spec auth.FallbackSpec, chain []string, try Attempt[R], classify func(error) Reason) (R, []Event, error) {
	var zero R
	var events []Event
	if len(chain) == 0 {
		// No fallback configured; treat as single attempt with empty slot.
		chain = []string{""}
	}
	max := eng.opts.MaxAttempts
	if spec.MaxAttempts > 0 && (max == 0 || spec.MaxAttempts < max) {
		max = spec.MaxAttempts
	}
	triggers := eng.opts.Triggers
	if len(spec.On) > 0 {
		triggers = make(map[Reason]bool, len(spec.On))
		for _, code := range spec.On {
			triggers[codeToReason(code)] = true
		}
	}

	var firstErr error
	for i, cred := range chain {
		if max > 0 && i >= max {
			events = append(events, Event{Slot: i, Credential: cred, Reason: ReasonChainExhausted})
			break
		}
		if err := ctx.Err(); err != nil {
			events = append(events, Event{Slot: i, Credential: cred, Reason: ReasonContextCancel, Err: err})
			return zero, events, err
		}
		if cred != "" && eng.opts.Breakers != nil && !eng.opts.Breakers.Allow(cred) {
			events = append(events, Event{Slot: i, Credential: cred, Reason: ReasonCircuitOpen})
			continue
		}
		attemptCtx := ctx
		var cancel context.CancelFunc
		if eng.opts.PerAttemptTimeout > 0 {
			attemptCtx, cancel = context.WithTimeout(ctx, eng.opts.PerAttemptTimeout)
		}
		t0 := time.Now()
		result, err, retryable := try(attemptCtx, cred)
		duration := time.Since(t0).Milliseconds()
		if cancel != nil {
			cancel()
		}
		if err == nil {
			reason := ReasonPrimarySuccess
			if i > 0 {
				reason = ReasonFallbackSuccess
			}
			events = append(events, Event{Slot: i, Credential: cred, Reason: reason, DurationMS: duration})
			if cred != "" && eng.opts.Breakers != nil {
				eng.opts.Breakers.RecordSuccess(cred)
			}
			return result, events, nil
		}
		if firstErr == nil {
			firstErr = err
		}
		reason := ReasonNonRetryable
		if retryable && classify != nil {
			reason = classify(err)
		}
		events = append(events, Event{Slot: i, Credential: cred, Reason: reason, DurationMS: duration, Err: err})
		if cred != "" && eng.opts.Breakers != nil {
			eng.opts.Breakers.RecordFailure(cred)
		}
		if !retryable {
			return zero, events, err
		}
		if !triggers[reason] {
			// Not in the configured trigger set — stop walking. This
			// matches the behaviour where a VK can narrow the triggers
			// to e.g. only "5xx" and see a 429 land as an un-faded-over
			// client error.
			return zero, events, err
		}
	}
	if firstErr == nil {
		firstErr = errors.New("fallback chain exhausted with no attempts made")
	}
	return zero, events, fmt.Errorf("fallback chain exhausted: %w", firstErr)
}

// codeToReason maps the contract's on-list codes (5xx|timeout|rate_limit_exceeded|network)
// to the Reason enum used by classify().
func codeToReason(code string) Reason {
	switch code {
	case "5xx":
		return ReasonRetryable5xx
	case "timeout":
		return ReasonRetryableTimeout
	case "rate_limit", "rate_limit_exceeded":
		return ReasonRetryable429
	case "network":
		return ReasonRetryableNetwork
	}
	return Reason(code)
}
