package domain

import (
	"fmt"

	"github.com/langwatch/langwatch/pkg/herr"
)

// UpstreamError carries a provider's terminal HTTP response so the gateway
// forwards it to the client verbatim instead of masking it as a generic
// 502. Streaming dispatch can only return an error (not a *Response), so the
// upstream status, native error body, and message ride on the error and the
// HTTP layer writes them. A client (claude-code, the OpenAI SDK, ...) decides
// retryable-vs-terminal from the status code, so collapsing an upstream 400
// (e.g. "credit balance too low") into a 502 makes it retry a terminal error
// indefinitely.
type UpstreamError struct {
	// StatusCode is the provider's HTTP status, forwarded verbatim.
	StatusCode int
	// Body is the provider's native error body, forwarded byte-for-byte when
	// Bifrost captured it (raw-forward paths). Empty when only the status and
	// message are available.
	Body []byte
	// Message is the provider's error message, used to build a minimal
	// envelope when Body is empty.
	Message string
	// Headers carries the upstream's retry-signaling response headers
	// (Retry-After, x-should-retry) so the client can honor the provider's
	// backoff hint and terminal-vs-retryable signal instead of guessing.
	Headers map[string]string
}

func (e *UpstreamError) Error() string {
	return fmt.Sprintf("upstream error (status %d): %s", e.StatusCode, e.Message)
}

// Gateway-specific error codes.
const (
	ErrInvalidAPIKey    = herr.Code("invalid_api_key")
	ErrBudgetExceeded   = herr.Code("budget_exceeded")
	ErrRateLimited      = herr.Code("rate_limited")
	ErrGuardrailBlocked = herr.Code("guardrail_blocked")
	ErrPolicyViolation  = herr.Code("policy_violation")
	ErrModelNotAllowed  = herr.Code("model_not_allowed")
	ErrProviderError    = herr.Code("provider_error")
	ErrPayloadTooLarge  = herr.Code("payload_too_large")
	ErrBadRequest       = herr.Code("bad_request")
	ErrNotFound         = herr.Code("not_found")
	ErrInternal         = herr.Code("internal_error")
	ErrChainExhausted   = herr.Code("chain_exhausted")
	ErrCircuitOpen      = herr.Code("circuit_open")
	ErrProviderTimeout  = herr.Code("provider_timeout")
	ErrKeyRevoked       = herr.Code("virtual_key_revoked")
	ErrAuthUpstream     = herr.Code("auth_upstream_unavailable")
)
