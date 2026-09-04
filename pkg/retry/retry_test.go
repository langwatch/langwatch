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

// The breaker exists to answer "is this slot healthy", and only an outcome that
// actually reached the slot can answer it. Crediting a success for a request
// that never dialed force-closes an open circuit — RecordSuccess sets Closed
// and truncates the failure window — so a provider that is genuinely down keeps
// being dialed. Faulting the slot instead would open a circuit on a provider
// that did nothing wrong.
func TestRecordBreakerIgnoresOutcomesThatNeverReachedTheSlot(t *testing.T) {
	for _, reason := range []Reason{ReasonContextDone, ReasonNotDialed} {
		t.Run(string(reason), func(t *testing.T) {
			breaker := newMockBreaker()

			recordBreaker(breaker, "slot-1", reason)

			if got, ok := breaker.recorded["slot-1"]; ok {
				t.Fatalf("%s recorded %q on the breaker; it must record nothing", reason, got)
			}
		})
	}
}

// The counterpart: an answered terminal 4xx DOES prove the slot alive, so it
// must still credit a success. That distinction is why ReasonNotDialed exists,
// and collapsing the two back together would otherwise be silent.
func TestRecordBreakerStillCreditsAnAnsweredTerminalError(t *testing.T) {
	breaker := newMockBreaker()

	recordBreaker(breaker, "slot-1", ReasonNonRetryable)

	if breaker.recorded["slot-1"] != "success" {
		t.Fatalf("an answered terminal error must prove the slot alive, got %q",
			breaker.recorded["slot-1"])
	}
}

// A reason that ends the walk must not also be a retry trigger, or the walk
// would dial the next slot for a failure it has already called terminal.
func TestNotDialedNeitherRetriesNorOpensTheCircuit(t *testing.T) {
	if defaultTriggers[ReasonNotDialed] {
		t.Fatal("ReasonNotDialed must not trigger a retry")
	}
	if breakerFailureReasons[ReasonNotDialed] {
		t.Fatal("ReasonNotDialed must not count toward opening the circuit")
	}
}

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

// An exhausted chain must surface the freshest verdict, the LAST slot's
// error, because callers forward it to their own clients. Surfacing the
// first would misreport what the final candidate answered.
func TestWalk_ChainExhaustedSurfacesLastError(t *testing.T) {
	errFirst := fmt.Errorf("first slot: %w", errRetryable)
	errLast := fmt.Errorf("last slot: %w", errRetryable)
	chain := []string{"a", "b"}
	attempt := func(_ context.Context, slot string) (string, error) {
		if slot == "a" {
			return "", errFirst
		}
		return "", errLast
	}

	_, el, err := Walk(context.Background(), Options{}, chain, attempt, retryableClassifier)
	defer el.Release()

	require.Error(t, err)
	require.ErrorIs(t, err, errLast)
	assert.NotErrorIs(t, err, errFirst)
}

// A walk where the breaker blocks every slot has no attempt error to
// surface. It must return the typed ErrNoAttempts sentinel so the caller can
// translate it: the previous anonymous error fell through the transport's
// typed branches and reached clients as a 500 internal_error.
func TestWalk_AllSlotsCircuitOpenReturnsErrNoAttempts(t *testing.T) {
	b := newMockBreaker()
	b.blocked["a"] = true
	b.blocked["b"] = true

	chain := []string{"a", "b"}
	attempt := func(_ context.Context, _ string) (string, error) {
		t.Fatal("no attempt should run")
		return "", nil
	}

	_, el, err := Walk(context.Background(), Options{Breaker: b}, chain, attempt, retryableClassifier)
	defer el.Release()

	require.Error(t, err)
	require.ErrorIs(t, err, ErrNoAttempts)
	for _, e := range el.Events() {
		assert.Equal(t, ReasonCircuitOpen, e.Reason)
	}
}

// Breaker health policy: only slot-health outcomes (5xx, timeout, network)
// count as failures. An answered 4xx proves the slot alive and resets the
// breaker. Counting 429s as failures used to open the circuit during
// provider quota outages. Caller-abandoned attempts record nothing.
func TestWalk_BreakerRecordsByReason(t *testing.T) {
	cases := []struct {
		name   string
		reason Reason
		want   string // "success", "failure", or "" for no record
	}{
		{"5xx counts as failure", ReasonRetryable5xx, "failure"},
		{"timeout counts as failure", ReasonTimeout, "failure"},
		{"network counts as failure", ReasonNetwork, "failure"},
		{"rate limit proves the slot alive", ReasonRateLimit, "success"},
		{"not found proves the slot alive", ReasonNotFound, "success"},
		{"terminal 4xx proves the slot alive", ReasonNonRetryable, "success"},
		{"caller abandonment records nothing", ReasonContextDone, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			b := newMockBreaker()
			classifier := func(error) Reason { return tc.reason }
			attempt := func(_ context.Context, _ string) (string, error) {
				return "", errFatal
			}

			_, el, err := Walk(context.Background(), Options{Breaker: b}, []string{"a"}, attempt, classifier)
			defer el.Release()

			require.Error(t, err)
			assert.Equal(t, tc.want, b.recorded["a"])
		})
	}
}
