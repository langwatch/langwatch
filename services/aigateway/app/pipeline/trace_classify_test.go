package pipeline

import (
	"context"
	"errors"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// @scenario "A gateway-authored failure records its own status and code"
func TestClassifyUpstream_HandledErrorsCarryTheirOwnIdentity(t *testing.T) {
	// Every one of these reaches classifyUpstream through the same door a
	// provider failure does — dispatch returned an error after the model was
	// resolved — and every one of them used to land on the customer's span as
	// a 502 provider_error, pointing at an upstream that never failed.
	registerTestStatuses()

	tests := []struct {
		name        string
		err         error
		wantStatus  int
		wantErrType string
	}{
		{
			name:        "the customer's own provider sign-in died",
			err:         herr.New(context.Background(), domain.ErrCodexSessionExpired, herr.M{"message": "expired"}),
			wantStatus:  http.StatusUnauthorized,
			wantErrType: "codex_session_expired",
		},
		{
			name:        "a guardrail we run blocked the request",
			err:         herr.New(context.Background(), domain.ErrGuardrailBlocked, herr.M{"message": "blocked"}),
			wantStatus:  http.StatusForbidden,
			wantErrType: "guardrail_blocked",
		},
		{
			name:        "a limit the gateway imposed, not the provider",
			err:         herr.New(context.Background(), domain.ErrRateLimited, nil),
			wantStatus:  http.StatusTooManyRequests,
			wantErrType: "rate_limited",
		},
		{
			// Already correct before, and it has to stay correct: this is the
			// case the generic fallback was actually written for.
			name:        "a provider failure the adapter typed for us",
			err:         herr.New(context.Background(), domain.ErrProviderError, herr.M{"message": "upstream blew up"}),
			wantStatus:  http.StatusBadGateway,
			wantErrType: "provider_error",
		},
		{
			name:        "a wrapped handled error still unwraps to its own identity",
			err:         errors.Join(errors.New("context"), herr.New(context.Background(), domain.ErrBudgetExceeded, nil)),
			wantStatus:  http.StatusPaymentRequired,
			wantErrType: "budget_exceeded",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			status, errType := classifyUpstream(tt.err)
			assert.Equal(t, tt.wantStatus, status)
			assert.Equal(t, tt.wantErrType, errType)
		})
	}
}

// @scenario "A gateway-authored failure records its own status and code"
func TestClassifyUpstream_UntypedFailureStaysGeneric(t *testing.T) {
	// An error nobody classified is the one case where "the upstream failed"
	// is the honest default, so the fallback must not be swallowed by the
	// handled-error branch above.
	status, errType := classifyUpstream(errors.New("nil pointer somewhere"))
	assert.Equal(t, http.StatusBadGateway, status)
	assert.Equal(t, "provider_error", errType)
}

// @scenario "A gateway-authored failure records its own status and code"
func TestClassifyUpstream_ForwardedProviderResponseStillWins(t *testing.T) {
	// A *domain.UpstreamError IS the provider's own answer, and its verbatim
	// status keeps precedence over anything the handled-error branch would
	// infer.
	tests := []struct {
		name        string
		err         error
		wantStatus  int
		wantErrType string
	}{
		{"a provider rate limit", &domain.UpstreamError{StatusCode: 429}, 429, "rate_limited"},
		{"a provider outage", &domain.UpstreamError{StatusCode: 503}, 503, "provider_error"},
		{"a provider rejecting the caller", &domain.UpstreamError{StatusCode: 402}, 402, "bad_request"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			status, errType := classifyUpstream(tt.err)
			assert.Equal(t, tt.wantStatus, status)
			assert.Equal(t, tt.wantErrType, errType)
		})
	}
}

// registerTestStatuses mirrors the router's registerErrorStatuses for the
// codes this test asserts on. The registry is process-global and the router
// package is not importable from here (it imports this one), so the mapping
// is restated rather than reached for.
func registerTestStatuses() {
	herr.RegisterStatus(domain.ErrCodexSessionExpired, http.StatusUnauthorized)
	herr.RegisterStatus(domain.ErrGuardrailBlocked, http.StatusForbidden)
	herr.RegisterStatus(domain.ErrRateLimited, http.StatusTooManyRequests)
	herr.RegisterStatus(domain.ErrProviderError, http.StatusBadGateway)
	herr.RegisterStatus(domain.ErrBudgetExceeded, http.StatusPaymentRequired)
}
