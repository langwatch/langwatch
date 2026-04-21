package domain

import "github.com/langwatch/langwatch/pkg/herr"

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
