package a2aproxy

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/url"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// refusal is one way the proxy says no. Codes sit in the JSON-RPC
// server-defined range that A2A leaves free.
type refusal struct {
	code   int
	reason string
	msg    string
	status int
}

var (
	refuseInvalidRequest  = refusal{-32600, "a2a_invalid_request", "the body is not a valid A2A request", http.StatusBadRequest}
	refuseInvalidPath     = refusal{-32600, "a2a_invalid_request", "the A2A path is not allowed", http.StatusBadRequest}
	refuseBodyTimeout     = refusal{-32600, "a2a_invalid_request", "the request body did not arrive in time", http.StatusBadRequest}
	refuseTargetBlocked   = refusal{-32011, string(domain.A2ATargetBlocked), "this A2A agent is blocked", http.StatusForbidden}
	refuseContentBlocked  = refusal{-32012, "a2a_content_blocked", "blocked by a guardrail", http.StatusForbidden}
	refuseTargetNotFound  = refusal{-32013, "a2a_target_not_found", "no such A2A agent in this project", http.StatusNotFound}
	refuseScanUnavailable = refusal{-32014, "a2a_scan_unavailable", "the content scan could not complete", http.StatusServiceUnavailable}
	refuseUpstream        = refusal{-32015, "a2a_upstream_unreachable", "the A2A agent did not answer", http.StatusBadGateway}
	refuseUnauthenticated = refusal{-32016, "a2a_unauthenticated", "no virtual key on the request", http.StatusUnauthorized}
	refuseRegistry        = refusal{-32017, "a2a_registry_unavailable", "the A2A registry is unavailable", http.StatusServiceUnavailable}
	refuseUnscannable     = refusal{-32018, "a2a_content_unscannable", "the content is not JSON the guardrail scan can read", http.StatusUnprocessableEntity}
	refuseTooLarge        = refusal{-32019, "a2a_payload_too_large", "the request body is over the size limit", http.StatusRequestEntityTooLarge}
	refuseBusy            = refusal{-32020, "a2a_too_many_requests", "this virtual key has too many A2A calls in flight", http.StatusTooManyRequests}
	refuseRateLimited     = refusal{-32021, "a2a_rate_limited", "this virtual key is over its rate limit", http.StatusTooManyRequests}
	refuseBudgetExceeded  = refusal{-32022, "a2a_budget_exceeded", "a budget for this virtual key is used up", http.StatusPaymentRequired}
	refuseNotHTTPS        = refusal{-32023, "a2a_target_not_https", "this gateway calls A2A agents over https only", http.StatusBadGateway}
	refusePublicURLUnset  = refusal{-32024, "a2a_public_url_unset", "this gateway has no public URL to put in an Agent Card: set A2A_PUBLIC_BASE_URL", http.StatusServiceUnavailable}
	refuseUnsupported     = refusal{-32601, "a2a_operation_not_supported", "this method and path, or this JSON-RPC method, is not an A2A operation", http.StatusNotFound}
)

// Reply-side variants: the upstream sent something the proxy will not relay.
var (
	refuseReplyUnscannable = refusal{refuseUnscannable.code, refuseUnscannable.reason, "the A2A agent reply is not JSON the guardrail scan can read", http.StatusBadGateway}
	refuseReplyTooLarge    = refusal{refuseTooLarge.code, refuseTooLarge.reason, "the A2A agent reply is over the size limit", http.StatusBadGateway}
)

// refuseWithCause refuses the call and keeps the error behind it for the operator.
func (h *Handler) refuseWithCause(c *call, r refusal, cause error) {
	h.recordCause(c, r.reason, cause)
	c.refuse(r)
}

// recordCause puts the error behind a refusal on the hop span and in a log
// line, as app/pipeline/guardrail.go does; the caller's reply never holds it.
func (h *Handler) recordCause(c *call, reason string, cause error) {
	cause = withoutURLSecrets(cause)
	c.span.RecordError(cause)
	h.cfg.Logger.Warn(reason, zap.String("a2a.target", c.name), zap.String("a2a.method", c.method), zap.Error(cause))
}

// withoutURLSecrets drops the query, fragment and user info from the URL an
// HTTP client error names: the target or the caller may keep a credential there.
func withoutURLSecrets(err error) error {
	var ue *url.Error
	if !errors.As(err, &ue) {
		return err
	}
	u, parseErr := url.Parse(ue.URL)
	if parseErr != nil {
		return &url.Error{Op: ue.Op, URL: "(unparsable URL)", Err: ue.Err}
	}
	u.RawQuery, u.ForceQuery, u.Fragment, u.User = "", false, "", nil
	return &url.Error{Op: ue.Op, URL: u.String(), Err: ue.Err}
}

func (r refusal) withMessage(msg string) refusal {
	r.msg = msg
	return r
}

func (c *call) markRefused(r refusal) {
	c.span.SetAttributes(attribute.String(attrDecision, r.reason))
	c.span.SetStatus(codes.Error, r.msg)
	c.refusedReason = r.reason
}

// refuse answers in the binding's error shape: a JSON-RPC error object with
// HTTP 200 for JSON-RPC, the HTTP status for HTTP+JSON.
func (c *call) refuse(r refusal) {
	c.markRefused(r)
	setJSONReply(c.w.Header())
	if c.binding == bindingJSONRPC {
		c.w.WriteHeader(http.StatusOK)
	} else {
		c.w.WriteHeader(r.status)
	}
	_, _ = c.w.Write(c.errorBody(r))
}

func (c *call) errorBody(r refusal) []byte {
	var out any
	if c.binding == bindingJSONRPC {
		id := c.id
		if len(id) == 0 {
			id = json.RawMessage("null")
		}
		out = map[string]any{
			"jsonrpc": "2.0",
			"id":      id,
			"error":   map[string]any{"code": r.code, "message": r.msg, "data": map[string]any{"reason": r.reason}},
		}
	} else {
		out = map[string]any{"error": map[string]any{
			"code": r.status, "status": http.StatusText(r.status), "message": r.msg, "reason": r.reason,
		}}
	}
	b, _ := json.Marshal(out)
	return b
}
