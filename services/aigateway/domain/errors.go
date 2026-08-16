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
	// ErrorType and ErrorCode are the provider's own error discriminants
	// (e.g. OpenAI "insufficient_quota", Anthropic "overloaded_error",
	// Bedrock "ThrottlingException") as parsed by the provider adapter.
	// They keep the error's identity on translated lanes where the native
	// body is not captured: without them the minimal envelope collapses
	// every provider verdict into a generic "provider_error" and the
	// client loses the code it dispatches its own handling on.
	ErrorType string
	ErrorCode string
	// Provider names the upstream this error came from (the credential's
	// provider id), so a multi-provider chain's surviving error says which
	// account to look at. Empty when the dispatch layer has not stamped it.
	Provider string
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
	ErrInvalidAPIKey  = herr.Code("invalid_api_key")
	ErrBudgetExceeded = herr.Code("budget_exceeded")
	// A per-end-user budget template is active on this key and the request
	// carried no end-user id: fail closed, a cap evadable by omitting a
	// field is not a cap.
	ErrEndUserRequired  = herr.Code("end_user_required")
	ErrRateLimited      = herr.Code("rate_limited")
	ErrGuardrailBlocked = herr.Code("guardrail_blocked")
	// ErrGuardrailUpstreamUnavailable means the guardrail could not be
	// evaluated at all. Fail-closed keys stop here rather than proceeding as
	// though the guardrail had passed. Contract 5.
	ErrGuardrailUpstreamUnavailable = herr.Code("guardrail_upstream_unavailable")
	ErrPolicyViolation              = herr.Code("policy_violation")
	ErrModelNotAllowed              = herr.Code("model_not_allowed")
	// ErrProviderNotBound means the request names a provider (explicit
	// "provider/model" prefix or alias) that has no credential slot on
	// this VK. Dispatching anyway would hand a mismatched credential to
	// the provider selected by the model prefix, which surfaces as opaque
	// provider-config errors ("deployments not set", HTML error pages).
	ErrProviderNotBound = herr.Code("model_provider_not_bound")
	ErrProviderError    = herr.Code("provider_error")
	ErrPayloadTooLarge  = herr.Code("payload_too_large")
	ErrBadRequest       = herr.Code("bad_request")
	// ErrMissingModel is a request-shape error with its own stable identity so
	// clients and rejection metrics do not have to infer it from prose.
	ErrMissingModel    = herr.Code("missing_model")
	ErrNotFound        = herr.Code("not_found")
	ErrInternal        = herr.Code("internal_error")
	ErrChainExhausted  = herr.Code("chain_exhausted")
	ErrCircuitOpen     = herr.Code("circuit_open")
	ErrProviderTimeout = herr.Code("provider_timeout")
	ErrKeyRevoked      = herr.Code("virtual_key_revoked")
	// ErrKeyDisabled is the REVERSIBLE stop: the key material is intact and
	// an administrator can re-enable it. Distinct from revoked (one-way)
	// so tenant tooling can branch on which one it is.
	ErrKeyDisabled  = herr.Code("virtual_key_disabled")
	ErrAuthUpstream = herr.Code("auth_upstream_unavailable")
	// ErrNoProviderConfigured means the virtual key's bundle carries zero
	// provider credentials — the organization has no ModelProvider configured.
	// Without this guard the dispatcher would hand Bifrost a zero-value
	// Credential and the caller would see an opaque "provider is required".
	ErrNoProviderConfigured = herr.Code("no_provider_configured")
	// ErrCodexSessionExpired means the codex provider's OAuth session is
	// dead (refresh rejected) — the user must sign in with OpenAI again.
	// Clients receive it as a 401 with this code so Langy can render the
	// re-authenticate card instead of a generic provider error.
	ErrCodexSessionExpired = herr.Code("codex_session_expired")
	// ErrUnsupportedParameter means the parameter policy refused a request
	// parameter for the target lane: either the request depends on it
	// functionally and the lane cannot honor it, or drop_tuning_params is false
	// and the lane has no mapping for it. The code matches OpenAI's own
	// parameter rejections so SDK error handling stays familiar.
	ErrUnsupportedParameter = herr.Code("unsupported_parameter")
	// ErrRealtimeSessionLimit means the virtual key already holds as many
	// open realtime voice sessions as its realtime.maxOpenSessions allows.
	// A voice session bills for as long as it runs, so the arrival-rate
	// limits do not bound it and this is the only cap that does.
	ErrRealtimeSessionLimit = herr.Code("realtime_session_limit")
	// ErrRealtimeRegistryUnavailable means the control plane could not
	// record the session, so the gateway refused to mint one. This is a
	// deliberate departure from the budget fail-open rule: an unrecorded
	// session is voice nobody can bill and a cap nobody can enforce.
	ErrRealtimeRegistryUnavailable = herr.Code("realtime_registry_unavailable")
)
