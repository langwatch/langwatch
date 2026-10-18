// Package providererr classifies a model provider's native error body into the
// few account-level causes a caller can act on, without carrying the provider's
// prose anywhere.
package providererr

import (
	"net/http"
	"strings"

	"github.com/tidwall/gjson"
)

// AccountExhausted reports whether a provider error is a terminal account-level
// exhaustion (credit, quota, billing) rather than a transient rate limit or a
// 5xx. Keyed on the terminal error code, never on bare status: an OpenAI
// rate_limit 429 is retryable and excluded, while a 429 carrying
// code/type=insufficient_quota is terminal and included.
func AccountExhausted(status int, body []byte) bool {
	if gjson.GetBytes(body, "error.code").String() == "insufficient_quota" ||
		gjson.GetBytes(body, "error.type").String() == "insufficient_quota" {
		return true
	}
	switch status {
	case http.StatusPaymentRequired:
		return true
	case http.StatusBadRequest:
		// Anthropic surfaces credit exhaustion as a 400 invalid_request_error
		// whose message names the credit balance.
		return strings.Contains(
			strings.ToLower(gjson.GetBytes(body, "error.message").String()),
			"credit balance",
		)
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
