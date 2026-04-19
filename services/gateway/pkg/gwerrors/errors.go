// Package gwerrors defines the canonical OpenAI-compatible error envelope
// returned by LangWatch AI Gateway on every error response.
package gwerrors

import (
	"encoding/json"
	"net/http"
)

type Type string

const (
	TypeInvalidAPIKey        Type = "invalid_api_key"
	TypeVirtualKeyRevoked    Type = "virtual_key_revoked"
	TypeBudgetExceeded       Type = "budget_exceeded"
	TypeGuardrailBlocked     Type = "guardrail_blocked"
	TypeProviderError        Type = "provider_error"
	TypeRateLimitExceeded    Type = "rate_limit_exceeded"
	TypeUpstreamTimeout      Type = "upstream_timeout"
	TypeCacheOverrideInvalid Type = "cache_override_invalid"
	TypeModelNotAllowed      Type = "model_not_allowed"
	TypeToolNotAllowed       Type = "tool_not_allowed"
	TypeURLNotAllowed        Type = "url_not_allowed"
	TypeBadRequest           Type = "bad_request"
	TypePayloadTooLarge      Type = "payload_too_large"
	TypeInternalError        Type = "internal_error"
	TypeServiceUnavailable   Type = "service_unavailable"
)

// Envelope is the wire-level error shape. OpenAI-compatible so any OpenAI SDK
// surfaces the error correctly. `Param` is optional; used when the error
// targets a specific request field.
type Envelope struct {
	Error Body `json:"error"`
}

type Body struct {
	Type    Type   `json:"type"`
	Code    string `json:"code"`
	Message string `json:"message"`
	Param   string `json:"param,omitempty"`
}

// HTTPStatus returns the HTTP status code that corresponds to an error Type.
func (t Type) HTTPStatus() int {
	switch t {
	case TypeInvalidAPIKey, TypeVirtualKeyRevoked:
		return http.StatusUnauthorized
	case TypeBudgetExceeded:
		return http.StatusPaymentRequired
	case TypeGuardrailBlocked, TypeModelNotAllowed, TypeToolNotAllowed, TypeURLNotAllowed:
		return http.StatusForbidden
	case TypeRateLimitExceeded:
		return http.StatusTooManyRequests
	case TypeUpstreamTimeout:
		return http.StatusGatewayTimeout
	case TypeProviderError:
		return http.StatusBadGateway
	case TypeCacheOverrideInvalid, TypeBadRequest:
		return http.StatusBadRequest
	case TypePayloadTooLarge:
		return http.StatusRequestEntityTooLarge
	case TypeServiceUnavailable:
		return http.StatusServiceUnavailable
	default:
		return http.StatusInternalServerError
	}
}

// Write emits the error envelope on w with correct status, content-type, and
// the LangWatch request id header.
func Write(w http.ResponseWriter, requestID string, t Type, code, message, param string) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("X-LangWatch-Request-Id", requestID)
	w.WriteHeader(t.HTTPStatus())
	_ = json.NewEncoder(w).Encode(Envelope{Error: Body{
		Type:    t,
		Code:    code,
		Message: message,
		Param:   param,
	}})
}
