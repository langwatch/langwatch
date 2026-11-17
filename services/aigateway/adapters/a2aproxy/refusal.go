package a2aproxy

import (
	"encoding/json"
	"net/http"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"

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
	refuseCallerNotAllow  = refusal{-32010, string(domain.A2ACallerNotAllowed), "this virtual key may not call this A2A agent", http.StatusForbidden}
	refuseTargetBlocked   = refusal{-32011, string(domain.A2ATargetBlocked), "this A2A agent is blocked", http.StatusForbidden}
	refuseContentBlocked  = refusal{-32012, "a2a_content_blocked", "blocked by a guardrail", http.StatusForbidden}
	refuseTargetNotFound  = refusal{-32013, "a2a_target_not_found", "no such A2A agent in this project", http.StatusNotFound}
	refuseScanUnavailable = refusal{-32014, "a2a_scan_unavailable", "the content scan could not complete", http.StatusServiceUnavailable}
	refuseUpstream        = refusal{-32015, "a2a_upstream_unreachable", "the A2A agent did not answer", http.StatusBadGateway}
	refuseUnauthenticated = refusal{-32016, "a2a_unauthenticated", "no virtual key on the request", http.StatusUnauthorized}
	refuseRegistry        = refusal{-32017, "a2a_registry_unavailable", "the A2A registry is unavailable", http.StatusServiceUnavailable}
	refuseUnscannable     = refusal{-32018, "a2a_content_unscannable", "the content is not JSON the guardrail scan can read", http.StatusUnprocessableEntity}
	refuseTooLarge        = refusal{-32019, "a2a_payload_too_large", "the request body is over the size limit", http.StatusRequestEntityTooLarge}
)

// Reply-side variants: the upstream sent something the proxy will not relay.
var (
	refuseReplyUnscannable = refusal{refuseUnscannable.code, refuseUnscannable.reason, "the A2A agent reply is not JSON the guardrail scan can read", http.StatusBadGateway}
	refuseReplyTooLarge    = refusal{refuseTooLarge.code, refuseTooLarge.reason, "the A2A agent reply is over the size limit", http.StatusBadGateway}
)

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
	c.w.Header().Set("Content-Type", "application/json")
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
