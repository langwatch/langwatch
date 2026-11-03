// Package providererr classifies a model provider's native error body into the
// few account-level causes a caller can act on, without carrying the provider's
// prose anywhere.
package providererr

import (
	"net/http"
	"strings"

	"github.com/tidwall/gjson"
)

// GatewayAccountExhaustedMessage replaces the provider's own message on an
// account-exhaustion error the AI gateway forwards, so a governed user is sent
// to their admin rather than to a billing page they do not own.
const GatewayAccountExhaustedMessage = "Your organization's AI gateway access is exhausted. Contact your LangWatch admin."

// GatewayAccountExhaustedCode is the error.code the gateway sets beside that
// message when the provider gave none. Readers classify on the code; the
// message match below only covers gateways released before the code existed.
const GatewayAccountExhaustedCode = "provider_account_exhausted"

// AccountExhausted reports whether a provider error is a terminal account-level
// exhaustion (credit, quota, billing), never a rate limit or a 5xx. Keyed on
// the error code, not bare status: a rate_limit 429 is excluded, a 429 with
// code/type=insufficient_quota is included. Status 0 is an error event inside
// a stream, which has no HTTP status of its own.
func AccountExhausted(status int, body []byte) bool {
	if status >= http.StatusInternalServerError {
		return false
	}
	code := gjson.GetBytes(body, "error.code").String()
	if code == "insufficient_quota" || code == GatewayAccountExhaustedCode ||
		gjson.GetBytes(body, "error.type").String() == "insufficient_quota" {
		return true
	}
	message := gjson.GetBytes(body, "error.message").String()
	if message == GatewayAccountExhaustedMessage {
		return true
	}
	switch status {
	case http.StatusPaymentRequired:
		return true
	case 0, http.StatusBadRequest:
		// Anthropic surfaces credit exhaustion as a 400 invalid_request_error
		// whose message names the credit balance.
		return strings.Contains(strings.ToLower(message), "credit balance")
	}
	return false
}

// KeyRejected reports whether the provider refused the credential itself: a
// 401 or 403 in every dialect, or Google's 400 whose details name an invalid key.
func KeyRejected(status int, body []byte) bool {
	if status == http.StatusUnauthorized || status == http.StatusForbidden {
		return true
	}
	if status != http.StatusBadRequest {
		return false
	}
	for _, detail := range gjson.GetBytes(body, "error.details").Array() {
		if detail.Get("reason").String() == "API_KEY_INVALID" {
			return true
		}
	}
	return gjson.GetBytes(body, "error.code").String() == "invalid_api_key"
}
