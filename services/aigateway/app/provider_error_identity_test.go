package app

import (
	"bytes"
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/breaker"
	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/pkg/retry"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// The incident these tests pin: while the upstream OpenAI account was out of
// credits, CI example bots calling the gateway's openai lane saw HTTP 500
// {"error":{"type":"internal_error"}} instead of the provider's 429
// insufficient_quota. Two defects compounded:
//
//  1. Raw-forward lanes return provider errors as success-shaped Responses,
//     so every streamed 429 counted as a breaker FAILURE while every
//     non-streamed one counted as a SUCCESS, and none of them fell back to
//     the next credential.
//  2. Once the flapping breaker opened, the retry walk ended with zero
//     attempts and returned a bare error that no transport branch
//     recognized, degrading into 500 internal_error.
//
// Spec: specs/ai-gateway/error-transparency.feature

const quota429Body = `{"error":{"message":"You exceeded your current quota, please check your plan and billing details.","type":"insufficient_quota","param":null,"code":"insufficient_quota"}}`

func quota429Response() *domain.Response {
	return &domain.Response{
		StatusCode: 429,
		Body:       []byte(quota429Body),
		Headers:    map[string]string{"Retry-After": "7"},
	}
}

// @scenario "Provider quota, rate-limit, and 5xx answers fail over to the next credential"
func TestHandleChat_RawForward429Response_FallsBack(t *testing.T) {
	for name, failing := range map[string]*domain.Response{
		"429 insufficient_quota": quota429Response(),
		"503 provider outage":    {StatusCode: 503, Body: []byte(`{"error":{"message":"upstream down","type":"server_error"}}`)},
	} {
		t.Run(name, func(t *testing.T) {
			callCount := 0
			provider := &mockProvider{
				dispatchFn: func(_ context.Context, _ *domain.Request, cred domain.Credential) (*domain.Response, error) {
					callCount++
					if cred.ID == "cred-1" {
						return failing, nil
					}
					return successResponse(), nil
				},
			}
			bundle := testBundle(
				domain.Credential{ID: "cred-1", ProviderID: domain.ProviderOpenAI, APIKey: "sk-1"},
				domain.Credential{ID: "cred-2", ProviderID: domain.ProviderOpenAI, APIKey: "sk-2"},
			)
			bundle.Config.Fallback.MaxAttempts = 2

			application := New(WithProviders(provider), WithLogger(zap.NewNop()))

			result, err := application.HandleChat(context.Background(), bundle, bytes.NewReader(testBody()), "gpt-4")
			require.NoError(t, err, "a provider quota/outage answer must fail over, that is the point of the credential chain")
			assert.Equal(t, 2, callCount)
			assert.Equal(t, 1, result.Meta.FallbackCount)
			assert.Equal(t, 200, result.Response.StatusCode)
		})
	}
}

// @scenario "Terminal provider 4xx answers do not fail over"
func TestHandleChat_RawForwardTerminal400Response_NoFallback(t *testing.T) {
	terminalBody := `{"error":{"message":"messages: at least one message is required","type":"invalid_request_error"}}`
	callCount := 0
	provider := &mockProvider{
		dispatchFn: func(_ context.Context, _ *domain.Request, _ domain.Credential) (*domain.Response, error) {
			callCount++
			return &domain.Response{StatusCode: 400, Body: []byte(terminalBody)}, nil
		},
	}
	bundle := testBundle(
		domain.Credential{ID: "cred-1", ProviderID: domain.ProviderOpenAI, APIKey: "sk-1"},
		domain.Credential{ID: "cred-2", ProviderID: domain.ProviderOpenAI, APIKey: "sk-2"},
	)
	bundle.Config.Fallback.MaxAttempts = 2

	application := New(WithProviders(provider), WithLogger(zap.NewNop()))

	_, err := application.HandleChat(context.Background(), bundle, bytes.NewReader(testBody()), "gpt-4")
	require.Error(t, err)
	assert.Equal(t, 1, callCount, "retrying an invalid request on the next key is pointless and must not happen")
	var ue *domain.UpstreamError
	require.ErrorAs(t, err, &ue)
	assert.Equal(t, 400, ue.StatusCode)
	assert.JSONEq(t, terminalBody, string(ue.Body), "the provider's native body must survive the reshaping verbatim")
	assert.Equal(t, "invalid_request_error", ue.ErrorType)
	assert.Equal(t, string(domain.ProviderOpenAI), ue.Provider)
}

// @scenario "An exhausted fallback chain surfaces the last provider's error"
func TestHandleChat_ChainExhausted_SurfacesLastProviderError(t *testing.T) {
	lastBody := `{"error":{"message":"Rate limit reached for gpt-4","type":"requests","code":"rate_limit_exceeded"}}`
	provider := &mockProvider{
		dispatchFn: func(_ context.Context, _ *domain.Request, cred domain.Credential) (*domain.Response, error) {
			if cred.ID == "cred-1" {
				return quota429Response(), nil
			}
			return &domain.Response{StatusCode: 429, Body: []byte(lastBody)}, nil
		},
	}
	bundle := testBundle(
		domain.Credential{ID: "cred-1", ProviderID: domain.ProviderOpenAI, APIKey: "sk-1"},
		domain.Credential{ID: "cred-2", ProviderID: domain.ProviderAnthropic, APIKey: "sk-2"},
	)
	bundle.Config.Fallback.MaxAttempts = 2

	application := New(WithProviders(provider), WithLogger(zap.NewNop()))

	_, err := application.HandleChat(context.Background(), bundle, bytes.NewReader(testBody()), "gpt-4")
	require.Error(t, err)
	var ue *domain.UpstreamError
	require.ErrorAs(t, err, &ue, "chain exhaustion must surface the provider's mapped error, never a bare internal one")
	assert.Equal(t, 429, ue.StatusCode)
	assert.JSONEq(t, lastBody, string(ue.Body), "the LAST candidate's verdict is the freshest and the one to forward")
	assert.Equal(t, "rate_limit_exceeded", ue.ErrorCode)
	assert.Equal(t, string(domain.ProviderAnthropic), ue.Provider,
		"the surviving error must say which upstream account it came from")
}

// blockedBreaker short-circuits every slot, the state a fully open circuit
// breaker leaves the walk in.
type blockedBreaker struct{}

func (blockedBreaker) Allow(string) bool          { return false }
func (blockedBreaker) RecordSuccess(string)       {}
func (blockedBreaker) RecordFailure(string)       {}
func (blockedBreaker) State(string) breaker.State { return breaker.Open }

// @scenario "An open circuit breaker surfaces circuit_open, not internal_error"
func TestHandleChat_CircuitOpen_TypedError(t *testing.T) {
	provider := &mockProvider{
		dispatchFn: func(_ context.Context, _ *domain.Request, _ domain.Credential) (*domain.Response, error) {
			t.Fatal("dispatch must not run when the breaker blocks every slot")
			return nil, nil
		},
	}

	application := New(
		WithProviders(provider),
		WithCircuitBreaker(blockedBreaker{}),
		WithLogger(zap.NewNop()),
	)

	_, err := application.HandleChat(context.Background(), testBundle(), bytes.NewReader(testBody()), "gpt-4")
	require.Error(t, err)
	assert.True(t, herr.IsCode(err, domain.ErrCircuitOpen),
		"a zero-attempt walk must translate to circuit_open, the incident surfaced it as 500 internal_error; got %v", err)
}

// @scenario "An open circuit breaker surfaces circuit_open, not internal_error"
func TestHandleChatStream_CircuitOpen_TypedError(t *testing.T) {
	provider := &mockProvider{
		streamFn: func(_ context.Context, _ *domain.Request, _ domain.Credential) (domain.StreamIterator, error) {
			t.Fatal("dispatch must not run when the breaker blocks every slot")
			return nil, nil
		},
	}

	application := New(
		WithProviders(provider),
		WithCircuitBreaker(blockedBreaker{}),
		WithLogger(zap.NewNop()),
	)

	body := []byte(`{"model":"gpt-4","messages":[{"role":"user","content":"hi"}],"stream":true}`)
	_, err := application.HandleChatStream(context.Background(), testBundle(), bytes.NewReader(body), "gpt-4")
	require.Error(t, err)
	assert.True(t, herr.IsCode(err, domain.ErrCircuitOpen), "got %v", err)
}

// countingBreaker records how the walk reports slot health.
type countingBreaker struct {
	successes int
	failures  int
}

func (b *countingBreaker) Allow(string) bool          { return true }
func (b *countingBreaker) RecordSuccess(string)       { b.successes++ }
func (b *countingBreaker) RecordFailure(string)       { b.failures++ }
func (b *countingBreaker) State(string) breaker.State { return breaker.Closed }

// @scenario "Provider 4xx answers do not open the circuit breaker"
func TestHandleChat_429DoesNotCountAsBreakerFailure(t *testing.T) {
	provider := &mockProvider{
		dispatchFn: func(_ context.Context, _ *domain.Request, _ domain.Credential) (*domain.Response, error) {
			return quota429Response(), nil
		},
	}
	counting := &countingBreaker{}

	application := New(
		WithProviders(provider),
		WithCircuitBreaker(counting),
		WithLogger(zap.NewNop()),
	)

	_, err := application.HandleChat(context.Background(), testBundle(), bytes.NewReader(testBody()), "gpt-4")
	require.Error(t, err)
	assert.Zero(t, counting.failures,
		"a 429 is the provider answering, not the slot failing; counting it opened the breaker during quota outages")
	assert.Equal(t, 1, counting.successes,
		"an answered 4xx proves the slot alive and must reset the breaker")
}

// @scenario "Provider 5xx answers count toward opening the circuit breaker"
func TestHandleChat_5xxCountsAsBreakerFailure(t *testing.T) {
	provider := &mockProvider{
		dispatchFn: func(_ context.Context, _ *domain.Request, _ domain.Credential) (*domain.Response, error) {
			return &domain.Response{StatusCode: 503, Body: []byte(`{"error":{"message":"overloaded"}}`)}, nil
		},
	}
	counting := &countingBreaker{}

	application := New(
		WithProviders(provider),
		WithCircuitBreaker(counting),
		WithLogger(zap.NewNop()),
	)

	_, err := application.HandleChat(context.Background(), testBundle(), bytes.NewReader(testBody()), "gpt-4")
	require.Error(t, err)
	assert.Equal(t, 1, counting.failures, "a 5xx is the upstream reporting itself broken")
	assert.Zero(t, counting.successes)
}

// @scenario "The gateway's own refusals never trigger provider fallback"
func TestHandleChat_BudgetBlock_NeverDispatches(t *testing.T) {
	dispatched := false
	provider := &mockProvider{
		dispatchFn: func(_ context.Context, _ *domain.Request, _ domain.Credential) (*domain.Response, error) {
			dispatched = true
			return successResponse(), nil
		},
	}
	budget := &mockBudget{
		precheckFn: func(_ context.Context, _ *domain.Bundle) (domain.BudgetDecision, error) {
			return domain.BudgetDecision{Verdict: domain.BudgetBlock}, nil
		},
	}

	application := New(
		WithProviders(provider),
		WithBudget(budget),
		WithLogger(zap.NewNop()),
	)

	_, err := application.HandleChat(context.Background(), testBundle(
		domain.Credential{ID: "cred-1", ProviderID: domain.ProviderOpenAI, APIKey: "sk-1"},
		domain.Credential{ID: "cred-2", ProviderID: domain.ProviderOpenAI, APIKey: "sk-2"},
	), bytes.NewReader(testBody()), "gpt-4")
	require.Error(t, err)
	assert.True(t, herr.IsCode(err, domain.ErrBudgetExceeded))
	assert.False(t, dispatched,
		"our own policy refusal is not a provider failure; falling back would bypass the refusal")
}

// @scenario "A caller-abandoned request neither falls back nor moves the breaker"
func TestClassifyProviderError_ContextErrors(t *testing.T) {
	assert.Equal(t, retry.ReasonContextDone, classifyProviderError(context.Canceled))
	assert.Equal(t, retry.ReasonContextDone, classifyProviderError(context.DeadlineExceeded))
}
