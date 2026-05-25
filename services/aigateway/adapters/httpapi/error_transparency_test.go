package httpapi

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/services/aigateway/app"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// Bug 33: the gateway must forward a provider's terminal error verbatim — the
// upstream HTTP status and native error body — instead of masking it as a
// retryable 502. Agent clients (claude-code, OpenAI SDK) decide retryable-vs-
// terminal purely from the status code, so a terminal upstream 400 ("credit
// balance too low") wrapped as 502 makes the client retry a hopeless request
// up to 10x. The streaming path was the regression: it collapsed the upstream
// status into a "provider_error" 502 envelope (the real status survived only
// in an unused meta field), while the non-streaming path already forwarded it.
//
// Spec: specs/ai-gateway/error-transparency.feature
//
// Binding invariant (per the raw-body-present vs empty-body split): (a) the
// HTTP status equals the upstream status verbatim on BOTH paths — the actual
// fix; (b) the body is byte-for-byte when the provider supplied one. The
// credit-balance 400 is raw-body-present, so both hold here.
const upstreamCreditBody = `{"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}`

// A terminal 4xx that is NOT account-exhaustion (a malformed request). The
// credit-balance variant is intentionally re-messaged by the governance layer
// (see governance_messaging_test.go), so the verbatim-passthrough guarantee is
// demonstrated here with a generic terminal error the governance layer leaves
// untouched.
const upstreamTerminalBody = `{"type":"error","error":{"type":"invalid_request_error","message":"messages: at least one message is required"}}`

func errTransportAuth() *mockAuth {
	return &mockAuth{
		resolveFn: func(_ context.Context, _ string) (*domain.Bundle, error) {
			return testBundle(), nil
		},
	}
}

func messagesRequest(stream bool) *http.Request {
	body := `{"model":"claude-opus-4-7","messages":[{"role":"user","content":"hi"}]}`
	if stream {
		body = `{"model":"claude-opus-4-7","messages":[{"role":"user","content":"hi"}],"stream":true}`
	}
	req := httptest.NewRequest(http.MethodPost, "/v1/messages", bytes.NewReader([]byte(body)))
	req.Header.Set("Authorization", "Bearer vk-lw-test")
	return req
}

// @scenario "Upstream terminal 4xx is forwarded verbatim on the non-streaming path"
func TestRouter_UpstreamTerminal4xx_NonStreamVerbatim(t *testing.T) {
	provider := &mockProvider{
		dispatchFn: func(_ context.Context, _ *domain.Request, _ domain.Credential) (*domain.Response, error) {
			return &domain.Response{StatusCode: http.StatusBadRequest, Body: []byte(upstreamTerminalBody)}, nil
		},
	}
	router := buildRouter(
		app.WithAuth(errTransportAuth()),
		app.WithProviders(provider),
		app.WithLogger(zap.NewNop()),
	)

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, messagesRequest(false))

	require.Equal(t, http.StatusBadRequest, rec.Code)
	assert.JSONEq(t, upstreamTerminalBody, rec.Body.String())
	assert.NotContains(t, rec.Body.String(), "provider_error",
		"terminal upstream error must not be re-wrapped in a provider_error envelope")
}

// @scenario "Upstream terminal 4xx is forwarded verbatim on the streaming path"
func TestRouter_UpstreamTerminal4xx_StreamVerbatim(t *testing.T) {
	provider := &mockStreamProvider{
		dispatchStreamFn: func(_ context.Context, _ *domain.Request, _ domain.Credential) (domain.StreamIterator, error) {
			return nil, &domain.UpstreamError{
				StatusCode: http.StatusBadRequest,
				Body:       []byte(upstreamTerminalBody),
				Message:    "messages: at least one message is required",
			}
		},
	}
	router := buildRouter(
		app.WithAuth(errTransportAuth()),
		app.WithProviders(provider),
		app.WithLogger(zap.NewNop()),
	)

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, messagesRequest(true))

	require.Equal(t, http.StatusBadRequest, rec.Code,
		"streaming terminal 4xx must forward the upstream status, not a 502 envelope")
	assert.JSONEq(t, upstreamTerminalBody, rec.Body.String())
}

// @scenario "Terminal upstream error is identical across stream and non-stream"
func TestRouter_UpstreamTerminal_IdenticalAcrossPaths(t *testing.T) {
	const authErrBody = `{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}`
	provider := &mockStreamProvider{
		mockProvider: mockProvider{
			dispatchFn: func(_ context.Context, _ *domain.Request, _ domain.Credential) (*domain.Response, error) {
				return &domain.Response{StatusCode: http.StatusUnauthorized, Body: []byte(authErrBody)}, nil
			},
		},
		dispatchStreamFn: func(_ context.Context, _ *domain.Request, _ domain.Credential) (domain.StreamIterator, error) {
			return nil, &domain.UpstreamError{
				StatusCode: http.StatusUnauthorized,
				Body:       []byte(authErrBody),
				Message:    "invalid x-api-key",
			}
		},
	}
	router := buildRouter(
		app.WithAuth(errTransportAuth()),
		app.WithProviders(provider),
		app.WithLogger(zap.NewNop()),
	)

	call := func(stream bool) (int, string) {
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, messagesRequest(stream))
		return rec.Code, rec.Body.String()
	}

	nonStreamCode, nonStreamBody := call(false)
	streamCode, streamBody := call(true)

	require.Equal(t, http.StatusUnauthorized, nonStreamCode)
	require.Equal(t, http.StatusUnauthorized, streamCode)
	assert.Equal(t, nonStreamCode, streamCode,
		"stream and non-stream must carry the identical upstream status")
	assert.JSONEq(t, authErrBody, nonStreamBody)
	assert.JSONEq(t, authErrBody, streamBody)
}

// @scenario "Upstream retryable status is forwarded as-is without over-correction"
func TestRouter_UpstreamRetryable429_ForwardedWithHeaders(t *testing.T) {
	const rateLimitBody = `{"type":"error","error":{"type":"rate_limit_error","message":"rate limit exceeded"}}`
	provider := &mockStreamProvider{
		dispatchStreamFn: func(_ context.Context, _ *domain.Request, _ domain.Credential) (domain.StreamIterator, error) {
			return nil, &domain.UpstreamError{
				StatusCode: http.StatusTooManyRequests,
				Body:       []byte(rateLimitBody),
				Message:    "rate limit exceeded",
				Headers: map[string]string{
					"Retry-After":    "30",
					"X-Should-Retry": "true",
				},
			}
		},
	}
	router := buildRouter(
		app.WithAuth(errTransportAuth()),
		app.WithProviders(provider),
		app.WithLogger(zap.NewNop()),
	)

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, messagesRequest(true))

	require.Equal(t, http.StatusTooManyRequests, rec.Code,
		"a retryable upstream 429 must forward as 429, not be flattened to a terminal 4xx or masked as 502")
	assert.Equal(t, "30", rec.Header().Get("Retry-After"),
		"upstream Retry-After backoff hint must be preserved")
	assert.Equal(t, "true", rec.Header().Get("X-Should-Retry"),
		"upstream x-should-retry signal must be forwarded")
	assert.JSONEq(t, rateLimitBody, rec.Body.String())
}
