package retry

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// mockBreaker is a simple BreakerChecker for testing.
type mockBreaker struct {
	blocked  map[string]bool
	recorded map[string]string // last action: "success" or "failure"
}

func newMockBreaker() *mockBreaker {
	return &mockBreaker{
		blocked:  make(map[string]bool),
		recorded: make(map[string]string),
	}
}

func (m *mockBreaker) Allow(id string) bool    { return !m.blocked[id] }
func (m *mockBreaker) RecordSuccess(id string) { m.recorded[id] = "success" }
func (m *mockBreaker) RecordFailure(id string) { m.recorded[id] = "failure" }

var errRetryable = errors.New("retryable error")
var errFatal = errors.New("fatal error")

func retryableClassifier(err error) Reason {
	if errors.Is(err, errRetryable) {
		return ReasonRetryable5xx
	}
	return ReasonNonRetryable
}

func TestWalk_SuccessOnFirstSlot(t *testing.T) {
	chain := []string{"a", "b"}
	attempt := func(_ context.Context, slot string) (string, error) {
		return "ok-" + slot, nil
	}

	result, el, err := Walk(context.Background(), Options{}, chain, attempt, retryableClassifier)
	defer el.Release()

	events := el.Events()
	require.NoError(t, err)
	assert.Equal(t, "ok-a", result)
	require.Len(t, events, 1)
	assert.Equal(t, ReasonSuccess, events[0].Reason)
}

func TestWalk_FallbackSuccess(t *testing.T) {
	calls := 0
	chain := []string{"a", "b"}
	attempt := func(_ context.Context, slot string) (string, error) {
		calls++
		if slot == "a" {
			return "", errRetryable
		}
		return "ok-" + slot, nil
	}

	result, el, err := Walk(context.Background(), Options{}, chain, attempt, retryableClassifier)
	defer el.Release()

	events := el.Events()
	require.NoError(t, err)
	assert.Equal(t, "ok-b", result)
	assert.Equal(t, 2, calls)
	require.Len(t, events, 2)
	assert.Equal(t, ReasonRetryable5xx, events[0].Reason)
	assert.Equal(t, ReasonFallback, events[1].Reason)
}

func TestWalk_ChainExhausted(t *testing.T) {
	chain := []string{"a", "b", "c"}
	attempt := func(_ context.Context, _ string) (string, error) {
		return "", errRetryable
	}

	_, el, err := Walk(context.Background(), Options{}, chain, attempt, retryableClassifier)
	defer el.Release()

	require.Error(t, err)
	assert.Contains(t, err.Error(), "retry chain exhausted")
	assert.Len(t, el.Events(), 3)
}

func TestWalk_NonRetryableStops(t *testing.T) {
	chain := []string{"a", "b", "c"}
	attempt := func(_ context.Context, _ string) (string, error) {
		return "", errFatal
	}

	_, el, err := Walk(context.Background(), Options{}, chain, attempt, retryableClassifier)
	defer el.Release()

	events := el.Events()
	require.Error(t, err)
	require.ErrorIs(t, err, errFatal)
	require.Len(t, events, 1, "should stop after first non-retryable error")
	assert.Equal(t, ReasonNonRetryable, events[0].Reason)
}

func TestWalk_MaxAttempts(t *testing.T) {
	chain := []string{"a", "b", "c", "d"}
	calls := 0
	attempt := func(_ context.Context, _ string) (string, error) {
		calls++
		return "", errRetryable
	}

	_, el, err := Walk(context.Background(), Options{MaxAttempts: 2}, chain, attempt, retryableClassifier)
	defer el.Release()

	events := el.Events()
	require.Error(t, err)
	assert.Equal(t, 2, calls)
	// 2 attempt events + 1 chain_exhausted event
	require.Len(t, events, 3)
	assert.Equal(t, ReasonChainExhausted, events[2].Reason)
}

func TestWalk_ContextCanceled(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel() // cancel immediately

	chain := []string{"a"}
	attempt := func(_ context.Context, _ string) (string, error) {
		return "should not reach", nil
	}

	_, el, err := Walk(ctx, Options{}, chain, attempt, retryableClassifier)
	defer el.Release()

	events := el.Events()
	require.Error(t, err)
	require.Len(t, events, 1)
	assert.Equal(t, ReasonContextDone, events[0].Reason)
}

func TestWalk_BreakerSkipsSlot(t *testing.T) {
	b := newMockBreaker()
	b.blocked["b"] = true

	chain := []string{"a", "b", "c"}
	calls := []string{}
	attempt := func(_ context.Context, slot string) (string, error) {
		calls = append(calls, slot)
		if slot == "a" {
			return "", errRetryable
		}
		return "ok-" + slot, nil
	}

	result, el, err := Walk(context.Background(), Options{Breaker: b}, chain, attempt, retryableClassifier)
	defer el.Release()

	events := el.Events()
	require.NoError(t, err)
	assert.Equal(t, "ok-c", result)
	assert.Equal(t, []string{"a", "c"}, calls, "should skip slot b")

	// Find the circuit_open event for slot b.
	var circuitEvent *Event
	for i := range events {
		if events[i].Reason == ReasonCircuitOpen {
			circuitEvent = &events[i]
			break
		}
	}
	require.NotNil(t, circuitEvent)
	assert.Equal(t, "b", circuitEvent.SlotID)
}

func TestWalk_CircuitOpenDoesNotConsumeAttempts(t *testing.T) {
	b := newMockBreaker()
	b.blocked["a"] = true
	b.blocked["b"] = true

	chain := []string{"a", "b", "c", "d"}
	calls := 0
	attempt := func(_ context.Context, _ string) (string, error) {
		calls++
		return "", errRetryable
	}

	// MaxAttempts=1 but first two slots are circuit-open — they should NOT
	// consume the budget. Only slot "c" should actually be attempted.
	_, el, err := Walk(context.Background(), Options{MaxAttempts: 1, Breaker: b}, chain, attempt, retryableClassifier)
	defer el.Release()

	events := el.Events()
	require.Error(t, err)
	assert.Equal(t, 1, calls, "only 1 real attempt should be made")

	// Events: circuit_open(a), circuit_open(b), retryable(c), chain_exhausted(d)
	var reasons []Reason
	for _, e := range events {
		reasons = append(reasons, e.Reason)
	}
	assert.Equal(t, []Reason{ReasonCircuitOpen, ReasonCircuitOpen, ReasonRetryable5xx, ReasonChainExhausted}, reasons)
}

func TestWalk_EmptyChain(t *testing.T) {
	attempt := func(_ context.Context, slot string) (string, error) {
		return fmt.Sprintf("result-slot:%s", slot), nil
	}

	result, el, err := Walk(context.Background(), Options{}, nil, attempt, retryableClassifier)
	defer el.Release()

	events := el.Events()
	require.NoError(t, err)
	assert.Equal(t, "result-slot:", result)
	require.Len(t, events, 1)
	assert.Equal(t, ReasonSuccess, events[0].Reason)
}
