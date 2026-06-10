package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/tidwall/gjson"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/app"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// Governance error messaging: when a governed member is blocked by an
// account-level limit they cannot resolve themselves — the org's own gateway
// budget (402) or the org provider account running out of credit/quota — the
// gateway surfaces a hardcoded, admin-actionable message instead of a consumer
// billing prompt that points the member at an account they do not own. The
// message is the same for every org (no per-org configuration). The rewrite is
// message-only: HTTP status, error type, and retry-signaling headers are
// preserved, so the terminal-vs-retryable contract (bug 33) is untouched and
// the transform applies ONLY to the terminal account-exhaustion class. A
// retryable rate-limit passes through verbatim.
//
// Spec: specs/ai-gateway/governance/governance-error-messaging.feature

// rateLimitErrBody is a retryable provider rate-limit (NOT account
// exhaustion); it must never be re-messaged and must stay retryable.
const rateLimitErrBody = `{"type":"error","error":{"type":"rate_limit_error","message":"rate limit exceeded"}}`

// @scenario "Gateway-origin budget block carries an admin-actionable message a generic agent client renders"
func TestRouter_GovBudgetBlock_CarriesAdminActionableMessage(t *testing.T) {
	block := &mockBudget{
		precheckFn: func(_ context.Context, _ *domain.Bundle) (domain.BudgetVerdict, error) {
			return domain.BudgetBlock, nil
		},
	}
	provider := &mockProvider{
		dispatchFn: func(_ context.Context, _ *domain.Request, _ domain.Credential) (*domain.Response, error) {
			return successResponse(), nil
		},
	}
	router := buildRouter(
		app.WithAuth(errTransportAuth()),
		app.WithProviders(provider),
		app.WithBudget(block),
		app.WithLogger(zap.NewNop()),
	)

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", bytes.NewReader(chatBody()))
	req.Header.Set("Authorization", "Bearer vk-lw-test")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusPaymentRequired, rec.Code)
	var er herr.ErrorResponse
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&er))
	assert.Equal(t, "budget_exceeded", er.Error.Type)
	assert.NotEmpty(t, er.Error.Message)
	assert.NotEqual(t, "budget_exceeded", er.Error.Message,
		"the 402 must carry a human message, not echo the bare error code")
	assert.Contains(t, strings.ToLower(er.Error.Message), "admin",
		"the budget message must point the member at their admin")
}

// @scenario "Upstream account-exhaustion error is re-messaged, status and retry headers preserved"
func TestRouter_GovUpstreamAccountError_RemessagedStatusPreserved(t *testing.T) {
	provider := &mockStreamProvider{
		dispatchStreamFn: func(_ context.Context, _ *domain.Request, _ domain.Credential) (domain.StreamIterator, error) {
			return nil, &domain.UpstreamError{
				StatusCode: http.StatusBadRequest,
				Body:       []byte(upstreamCreditBody),
				Message:    "Your credit balance is too low to access the Anthropic API.",
				Headers:    map[string]string{"X-Should-Retry": "false"},
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
		"the upstream account-error status must be forwarded unchanged")
	assert.Equal(t, "false", rec.Header().Get("X-Should-Retry"),
		"the terminal retry signal must be preserved")
	body := rec.Body.String()
	msg := gjson.Get(body, "error.message").String()
	assert.NotContains(t, strings.ToLower(msg), "credit balance",
		"the provider credit-balance phrasing must be dropped so the client does not overlay its own billing prompt")
	assert.Contains(t, strings.ToLower(msg), "admin",
		"the human message must be replaced with the admin-actionable governance message")
	assert.Equal(t, "invalid_request_error", gjson.Get(body, "error.type").String(),
		"the upstream error type must be preserved")
}

// @scenario "A retryable rate-limit is forwarded verbatim and never re-messaged"
func TestRouter_GovRetryableRateLimit_NotRemessaged(t *testing.T) {
	provider := &mockStreamProvider{
		dispatchStreamFn: func(_ context.Context, _ *domain.Request, _ domain.Credential) (domain.StreamIterator, error) {
			return nil, &domain.UpstreamError{
				StatusCode: http.StatusTooManyRequests,
				Body:       []byte(rateLimitErrBody),
				Message:    "rate limit exceeded",
				Headers:    map[string]string{"Retry-After": "30", "X-Should-Retry": "true"},
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

	require.Equal(t, http.StatusTooManyRequests, rec.Code, "a retryable 429 must stay 429")
	assert.Equal(t, "30", rec.Header().Get("Retry-After"))
	assert.Equal(t, "true", rec.Header().Get("X-Should-Retry"), "must remain retryable")
	assert.JSONEq(t, rateLimitErrBody, rec.Body.String(),
		"a retryable rate-limit must pass through verbatim, never re-messaged with the governance string")
}
