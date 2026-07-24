package app

import (
	"errors"
	"net/http"
	"strings"

	"github.com/tidwall/gjson"
	"github.com/tidwall/sjson"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// accountExhaustionMessage is the message shown to a governed user when an
// upstream provider account is exhausted (credit/quota/billing). The user
// can't act on the provider's billing portal — the org admin owns the account
// — so we point them at the right contact. Avoids credit/billing wording so
// wrapper clients (e.g. Claude Code) render it verbatim instead of overlaying
// their own billing UI.
const accountExhaustionMessage = "Your organization's AI gateway access is exhausted. Contact your LangWatch admin."

// applyGovernanceMessage rewrites the human-facing message of a terminal
// account-level provider error to the gateway's governance message. It covers
// both shapes such an error can take coming out of dispatch: a non-stream
// raw-forward Response (a 4xx carrying the provider's native body) and a
// streaming *domain.UpstreamError.
//
// Only the message text changes — the HTTP status, error type, and
// retry-signaling headers are preserved verbatim, so the terminal-vs-retryable
// contract is untouched. It is a no-op for any error that is not account-level
// exhaustion: a transient rate-limit 429, a 5xx, or a user's own bad request
// all pass through unchanged.
func applyGovernanceMessage(resp *domain.Response, err error) (*domain.Response, error) {
	if resp != nil && isAccountExhaustion(resp.StatusCode, resp.Body) {
		resp.Body = rewriteErrorMessage(resp.Body, accountExhaustionMessage)
		return resp, err
	}
	var ue *domain.UpstreamError
	if errors.As(err, &ue) && isAccountExhaustion(ue.StatusCode, ue.Body) {
		ue.Message = accountExhaustionMessage
		ue.Body = rewriteErrorMessage(ue.Body, accountExhaustionMessage)
	}
	return resp, err
}

// isAccountExhaustion reports whether a provider error is a terminal
// account-level exhaustion (credit / quota / billing) that a governed end user
// cannot resolve themselves — as opposed to a transient rate limit or a 5xx,
// which must stay verbatim and retryable. Keyed on the terminal error code,
// never on bare status: an OpenAI rate_limit 429 is retryable and excluded,
// while a 429 carrying code/type=insufficient_quota is terminal and included.
func isAccountExhaustion(status int, body []byte) bool {
	if gjson.GetBytes(body, "error.code").String() == "insufficient_quota" ||
		gjson.GetBytes(body, "error.type").String() == "insufficient_quota" {
		return true
	}
	switch status {
	case http.StatusPaymentRequired: // 402 — generic billing / account block
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

// rewriteErrorMessage replaces only the error.message field of a provider
// error body, preserving the rest of the envelope (error.type, request_id,
// ...). Dropping the provider's original credit/billing phrasing is
// intentional: it stops a wrapper like Claude Code from pattern-matching the
// credit signal and overlaying its own billing link (wrong for a governed user
// who does not own the provider account), so the client renders the org's
// message instead. Returns the body unchanged when it carries no error.message.
func rewriteErrorMessage(body []byte, msg string) []byte {
	if len(body) == 0 || !gjson.GetBytes(body, "error.message").Exists() {
		return body
	}
	out, err := sjson.SetBytes(body, "error.message", msg)
	if err != nil {
		return body
	}
	return out
}
