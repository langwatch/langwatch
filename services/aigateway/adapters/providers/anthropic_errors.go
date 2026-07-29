package providers

import (
	"net/http"

	"github.com/bytedance/sonic"
	bfschemas "github.com/maximhq/bifrost/core/schemas"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// anthropicStatusOverloaded is Anthropic's own overload status. It is outside
// the net/http constants, and the SDKs retry on it, so a 529 relayed from an
// Anthropic-hosted destination must keep its retryable name.
const anthropicStatusOverloaded = 529

// anthropicErrorType maps an HTTP status onto the error `type` string
// Anthropic's API documents. Claude Code and the Anthropic SDKs switch on this
// value to decide retryable-vs-terminal, so a translated-lane failure has to
// name itself in their vocabulary rather than leaking gateway jargon.
func anthropicErrorType(status int) string {
	switch status {
	case http.StatusBadRequest:
		return "invalid_request_error"
	case http.StatusUnauthorized:
		return "authentication_error"
	case http.StatusForbidden:
		return "permission_error"
	case http.StatusNotFound:
		return "not_found_error"
	case http.StatusRequestEntityTooLarge:
		return "request_too_large"
	case http.StatusTooManyRequests:
		return "rate_limit_error"
	case http.StatusServiceUnavailable, anthropicStatusOverloaded:
		return "overloaded_error"
	default:
		return "api_error"
	}
}

// anthropicErrorBody renders the Anthropic error envelope
// ({"type":"error","error":{"type":...,"message":...}}). Used for both the
// non-streaming body and the terminal `event: error` SSE frame so a client
// sees one shape regardless of which lane failed.
func anthropicErrorBody(status int, message string) []byte {
	if message == "" {
		message = "the gateway could not complete the request"
	}
	body, err := sonic.Marshal(map[string]any{
		"type": "error",
		"error": map[string]any{
			"type":    anthropicErrorType(status),
			"message": message,
		},
	})
	if err != nil {
		return []byte(`{"type":"error","error":{"type":"api_error","message":"the gateway could not complete the request"}}`)
	}
	return body
}

// anthropicUpstreamError wraps a dispatch failure on the translated lane in an
// Anthropic-shaped envelope. Returning a domain.UpstreamError with Body set
// makes both writers forward it verbatim: writeError for the non-streaming
// path, streamErrorFrame for the SSE path.
func anthropicUpstreamError(status int, message string) *domain.UpstreamError {
	if status <= 0 {
		status = http.StatusBadGateway
	}
	return &domain.UpstreamError{
		StatusCode: status,
		Body:       anthropicErrorBody(status, message),
		Message:    message,
	}
}

// anthropicErrorFromBifrost converts a Bifrost dispatch error into an
// Anthropic-shaped upstream error. The provider's own status is preserved so
// terminal 4xx stay terminal; a zero status (transport failure, timeout) is
// reported as 502 rather than being allowed to surface as a silent stall.
func anthropicErrorFromBifrost(berr *bfschemas.BifrostError) *domain.UpstreamError {
	status := 0
	if berr != nil && berr.StatusCode != nil {
		status = *berr.StatusCode
	}
	return anthropicUpstreamError(status, bfErrorMsg(berr))
}
