// Package a2aproxy proxies A2A v1.0 calls from an agent holding a virtual key
// to a registered A2A agent: it applies the target's policy, scans message
// text both ways, forwards JSON-RPC, HTTP+JSON and SSE, and keeps the trace.
// Spec: specs/ai-gateway/a2a-proxy.feature.
package a2aproxy

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/trace"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// PathPrefix is where the proxy is mounted on the gateway.
const PathPrefix = "/a2a/"

const (
	maxBodyBytes  = 16 << 20
	maxEventBytes = 4 << 20
	cardPath      = "/.well-known/agent-card.json"
)

// Binding names follow a2a.protocol.binding values.
const (
	bindingJSONRPC  = "JSONRPC"
	bindingHTTPJSON = "HTTP+JSON"
)

// Attribute names. The a2a.* names follow the OpenTelemetry GenAI proposal
// (semantic-conventions-genai#254) and can still change.
const (
	attrAgentName       = "gen_ai.agent.name"
	attrOperationName   = "gen_ai.operation.name"
	attrBinding         = "a2a.protocol.binding"
	attrMethod          = "a2a.method"
	attrContextID       = "a2a.context.id"
	attrTaskID          = "a2a.task.id"
	attrTaskState       = "a2a.task.state"
	attrMessageID       = "a2a.message.id"
	attrTarget          = "langwatch.a2a.target"
	attrCallerVK        = "langwatch.a2a.caller.virtual_key_id"
	attrCallerAgentName = "langwatch.a2a.caller.agent.name"
	attrDecision        = "langwatch.a2a.decision"
)

// CallerAgentHeader optionally names the calling agent for the trace.
const CallerAgentHeader = "X-LangWatch-Agent-Name"

// forwardedHeaders are the caller headers that reach the upstream. The
// caller's Authorization (its virtual key) is never one of them.
var forwardedHeaders = []string{"Content-Type", "Accept", "A2A-Version", "A2A-Extensions", "X-A2A-Extensions"}

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
)

func (r refusal) withMessage(msg string) refusal {
	r.msg = msg
	return r
}

// Registry finds the target a caller asked for within the caller's project.
type Registry interface {
	Lookup(ctx context.Context, bundle *domain.Bundle, name string) (domain.A2ATarget, error)
}

// Config wires a Handler.
type Config struct {
	Registry Registry
	// Scanner checks message text. Nil scans nothing.
	Scanner Scanner
	// Bundle reads the authenticated caller from the request context.
	Bundle func(context.Context) *domain.Bundle
	// Client calls the upstream. Nil uses http.DefaultClient.
	Client *http.Client
	// Tracer records the hop. Nil uses the global tracer provider.
	Tracer trace.Tracer
}

// Handler serves /a2a/{target}/...
type Handler struct {
	cfg Config
}

// New builds the proxy handler.
func New(cfg Config) *Handler {
	if cfg.Scanner == nil {
		cfg.Scanner = NoopScanner{}
	}
	if cfg.Client == nil {
		cfg.Client = http.DefaultClient
	}
	if cfg.Tracer == nil {
		cfg.Tracer = otel.Tracer("github.com/langwatch/langwatch/services/aigateway/adapters/a2aproxy")
	}
	return &Handler{cfg: cfg}
}

// call is one proxied request as it moves through the stages.
type call struct {
	w       http.ResponseWriter
	r       *http.Request
	ctx     context.Context
	span    trace.Span
	bundle  *domain.Bundle
	name    string
	rest    string
	binding string
	method  string
	isCard  bool
	id      json.RawMessage
	body    []byte
	// refusedReason is set once the call has been refused.
	refusedReason string
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	c, bad := parseCall(w, r)
	ctx, span := h.cfg.Tracer.Start(spanParent(c), "invoke_agent "+c.name,
		trace.WithSpanKind(trace.SpanKindClient), trace.WithAttributes(spanAttrs(c)...))
	defer span.End()
	c.ctx, c.span = ctx, span
	if bad {
		c.refuse(refuseInvalidRequest)
		return
	}
	target, ok := h.admit(c)
	if !ok {
		return
	}
	if c.isCard {
		h.serveCard(c, target)
		return
	}
	h.forward(c, target)
}

// parseCall reads the target, binding, method and body. It reports true when
// the request cannot be read as A2A.
func parseCall(w http.ResponseWriter, r *http.Request) (*call, bool) {
	name, rest, _ := strings.Cut(strings.TrimPrefix(r.URL.Path, PathPrefix), "/")
	if rest != "" {
		rest = "/" + rest
	}
	c := &call{w: w, r: r, ctx: r.Context(), name: name, rest: rest, binding: bindingHTTPJSON}
	c.isCard = rest == cardPath && r.Method == http.MethodGet
	c.method = restMethod(r.Method, rest)
	if (rest == "" || rest == "/") && r.Method == http.MethodPost {
		c.binding = bindingJSONRPC
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, maxBodyBytes))
	c.body = body
	if err != nil {
		return c, true
	}
	if c.binding != bindingJSONRPC {
		return c, false
	}
	var env struct {
		ID     json.RawMessage `json:"id"`
		Method string          `json:"method"`
	}
	if json.Unmarshal(body, &env) != nil {
		return c, true
	}
	c.id, c.method = env.ID, env.Method
	return c, false
}

// spanParent is the caller's trace: the gateway middleware's span, or the
// request's traceparent when no span is on the context.
func spanParent(c *call) context.Context {
	if trace.SpanContextFromContext(c.ctx).IsValid() {
		return c.ctx
	}
	return propagation.TraceContext{}.Extract(c.ctx, propagation.HeaderCarrier(c.r.Header))
}

func spanAttrs(c *call) []attribute.KeyValue {
	attrs := []attribute.KeyValue{
		attribute.String(attrOperationName, "invoke_agent"),
		attribute.String(attrBinding, c.binding),
		attribute.String(attrMethod, c.method),
		attribute.String(attrTarget, c.name),
	}
	if caller := c.r.Header.Get(CallerAgentHeader); caller != "" {
		attrs = append(attrs, attribute.String(attrCallerAgentName, caller))
	}
	return attrs
}

// admit finds the target and applies its block switch and allow list.
func (h *Handler) admit(c *call) (domain.A2ATarget, bool) {
	c.bundle = h.cfg.Bundle(c.ctx)
	if c.bundle == nil {
		c.refuse(refuseUnauthenticated)
		return domain.A2ATarget{}, false
	}
	c.span.SetAttributes(attribute.String(attrCallerVK, c.bundle.VirtualKeyID))
	target, err := h.cfg.Registry.Lookup(c.ctx, c.bundle, c.name)
	if errors.Is(err, domain.ErrA2ATargetNotFound) {
		c.refuse(refuseTargetNotFound)
		return target, false
	}
	if err != nil {
		c.refuse(refuseRegistry)
		return target, false
	}
	if target.AgentName != "" {
		c.span.SetAttributes(attribute.String(attrAgentName, target.AgentName))
	}
	switch target.Admit(c.bundle.VirtualKeyID) {
	case domain.A2ATargetBlocked:
		r := refuseTargetBlocked
		if target.BlockReason != "" {
			r = r.withMessage(r.msg + ": " + target.BlockReason)
		}
		c.refuse(r)
		return target, false
	case domain.A2ACallerNotAllowed:
		c.refuse(refuseCallerNotAllow)
		return target, false
	case domain.A2AAllowed:
	}
	return target, true
}

func (h *Handler) forward(c *call, target domain.A2ATarget) {
	setMessageAttrs(c.span, c.body)
	if !h.scan(c, DirectionRequest, collectTexts(c.body)) {
		return
	}
	req, err := newUpstreamRequest(c, target)
	if err != nil {
		c.refuse(refuseUpstream.withMessage("the A2A agent URL is invalid"))
		return
	}
	resp, err := h.cfg.Client.Do(req)
	if err != nil {
		c.refuse(refuseUpstream)
		return
	}
	defer func() { _ = resp.Body.Close() }()

	if strings.HasPrefix(resp.Header.Get("Content-Type"), "text/event-stream") {
		h.stream(c, resp)
		return
	}
	respBody, err := io.ReadAll(io.LimitReader(resp.Body, maxBodyBytes))
	if err != nil {
		c.refuse(refuseUpstream.withMessage("the A2A agent reply was cut off"))
		return
	}
	setResultAttrs(c.span, respBody)
	if !h.scan(c, DirectionResponse, collectTexts(respBody)) {
		return
	}
	copyHeader(c.w.Header(), resp.Header)
	c.w.WriteHeader(resp.StatusCode)
	_, _ = c.w.Write(respBody)
}

func newUpstreamRequest(c *call, target domain.A2ATarget) (*http.Request, error) {
	upstreamURL := strings.TrimSuffix(target.UpstreamURL, "/") + c.rest
	if c.r.URL.RawQuery != "" {
		upstreamURL += "?" + c.r.URL.RawQuery
	}
	req, err := http.NewRequestWithContext(c.ctx, c.r.Method, upstreamURL, bytes.NewReader(c.body))
	if err != nil {
		return nil, err
	}
	for _, name := range forwardedHeaders {
		if v := c.r.Header.Get(name); v != "" {
			req.Header.Set(name, v)
		}
	}
	for k, v := range target.UpstreamHeaders {
		req.Header.Set(k, v)
	}
	propagation.TraceContext{}.Inject(c.ctx, propagation.HeaderCarrier(req.Header))
	return req, nil
}

// check runs the scanner and returns the refusal a deny verdict, or an error
// the key does not allow to fail open, calls for.
func (h *Handler) check(c *call, dir Direction, texts []string) *refusal {
	if len(texts) == 0 {
		return nil
	}
	verdict, err := h.cfg.Scanner.Scan(c.ctx, ScanInput{Bundle: c.bundle, Direction: dir, Texts: texts})
	if err != nil {
		failOpen := c.bundle.Config.Guardrails.RequestFailOpen
		if dir == DirectionResponse {
			failOpen = c.bundle.Config.Guardrails.ResponseFailOpen
		}
		if failOpen {
			c.span.SetAttributes(attribute.Bool("langwatch.a2a.scan.failed_open", true))
			return nil
		}
		return &refuseScanUnavailable
	}
	if verdict.Action != domain.GuardrailBlock {
		return nil
	}
	r := refuseContentBlocked
	if verdict.Message != "" {
		r = r.withMessage(r.msg + ": " + verdict.Message)
	}
	return &r
}

// scan refuses the call when check says so and reports whether it may go on.
func (h *Handler) scan(c *call, dir Direction, texts []string) bool {
	if r := h.check(c, dir, texts); r != nil {
		c.refuse(*r)
		return false
	}
	return true
}

// stream forwards an SSE reply event by event. An event that fails the scan
// is replaced by one error event and the stream ends.
func (h *Handler) stream(c *call, resp *http.Response) {
	copyHeader(c.w.Header(), resp.Header)
	c.w.WriteHeader(resp.StatusCode)
	flusher, _ := c.w.(http.Flusher)
	err := readEvents(resp.Body, func(event []byte) bool {
		data := eventData(event)
		setResultAttrs(c.span, data)
		if r := h.check(c, DirectionResponse, collectTexts(data)); r != nil {
			c.markRefused(*r)
			event = []byte("data: " + string(c.errorBody(*r)) + "\n\n")
		}
		_, _ = c.w.Write(event)
		if flusher != nil {
			flusher.Flush()
		}
		return c.refusedReason == ""
	})
	if err != nil {
		c.span.RecordError(err)
	}
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

// restMethod maps an HTTP+JSON path to its A2A method name.
func restMethod(httpMethod, rest string) string {
	switch {
	case rest == cardPath:
		return "GetAgentCard"
	case rest == "/message:send":
		return "SendMessage"
	case rest == "/message:stream":
		return "SendStreamingMessage"
	case strings.HasPrefix(rest, "/tasks/") && strings.HasSuffix(rest, ":cancel"):
		return "CancelTask"
	case strings.HasPrefix(rest, "/tasks/") && strings.HasSuffix(rest, ":subscribe"):
		return "SubscribeToTask"
	case strings.HasPrefix(rest, "/tasks/") && httpMethod == http.MethodGet:
		return "GetTask"
	case rest == "/tasks" && httpMethod == http.MethodGet:
		return "ListTasks"
	}
	return fmt.Sprintf("%s %s", httpMethod, rest)
}

func copyHeader(dst, src http.Header) {
	for k, vs := range src {
		switch http.CanonicalHeaderKey(k) {
		case "Content-Length", "Connection", "Transfer-Encoding":
			continue
		}
		dst[k] = append([]string(nil), vs...)
	}
}
