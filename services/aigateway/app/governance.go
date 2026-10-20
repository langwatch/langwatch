package app

import (
	"errors"
	"net/http"

	"github.com/tidwall/gjson"
	"github.com/tidwall/sjson"

	"github.com/langwatch/langwatch/pkg/providererr"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// accountExhaustionMessage is the message shown to a governed user when an
// upstream provider account is exhausted (credit/quota/billing). It avoids
// credit/billing wording so wrapper clients (e.g. Claude Code) render it
// verbatim instead of overlaying their own billing UI. The rewrite also sets
// error.code, which is what readers past the gateway classify on.
const accountExhaustionMessage = providererr.GatewayAccountExhaustedMessage

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
	if resp != nil && providererr.AccountExhausted(resp.StatusCode, resp.Body) {
		resp.Body = rewriteErrorMessage(resp.Body, accountExhaustionMessage)
		return resp, err
	}
	var ue *domain.UpstreamError
	if errors.As(err, &ue) && isAccountExhaustionError(ue) {
		ue.Message = accountExhaustionMessage
		ue.Body = rewriteErrorMessage(ue.Body, accountExhaustionMessage)
		if ue.ErrorCode == "" {
			ue.ErrorCode = providererr.GatewayAccountExhaustedCode
		}
	}
	return resp, err
}

// isAccountExhaustionError is the UpstreamError-shaped twin of
// providererr.AccountExhausted. Translated lanes carry the provider's error
// discriminants on the error itself rather than in a captured body, so the
// parsed type/code must count too or a quota error's original billing
// message would reach governed users on those lanes.
func isAccountExhaustionError(ue *domain.UpstreamError) bool {
	if ue.StatusCode >= http.StatusInternalServerError {
		return false
	}
	if ue.ErrorType == "insufficient_quota" || ue.ErrorCode == "insufficient_quota" {
		return true
	}
	return providererr.AccountExhausted(ue.StatusCode, ue.Body)
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
	// Readers past the gateway classify on this code, never on the sentence.
	// A provider's own code (OpenAI's insufficient_quota) is kept.
	if gjson.GetBytes(out, "error.code").String() == "" {
		if coded, err := sjson.SetBytes(out, "error.code", providererr.GatewayAccountExhaustedCode); err == nil {
			out = coded
		}
	}
	return out
}
