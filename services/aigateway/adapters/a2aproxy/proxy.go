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
	"io"
	"net/http"
	"strings"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/trace"

	"github.com/langwatch/langwatch/pkg/customertracebridge"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// PathPrefix is where the proxy is mounted on the gateway.
const PathPrefix = "/a2a/"

const (
	maxBodyBytes  = 1 << 20
	maxEventBytes = 1 << 20
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
	// attrProjectID is what the customer trace bridge routes a span by.
	attrProjectID = "langwatch.project_id"
)

// CallerAgentHeader optionally names the calling agent for the trace.
const CallerAgentHeader = "X-LangWatch-Agent-Name"

// forwardedHeaders are the caller headers that reach the upstream. The
// caller's Authorization (its virtual key) is never one of them.
var forwardedHeaders = []string{"Content-Type", "Accept", "A2A-Version", "A2A-Extensions", "X-A2A-Extensions"}

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
	// Client calls the upstream. Nil uses NewUpstreamClient(true).
	Client *http.Client
	// Tracer records the hop: the customer trace bridge's tracer, so the span
	// lands in the caller's project. Nil uses the global tracer provider.
	Tracer trace.Tracer
}

// Handler serves /a2a/{target}/...
type Handler struct {
	cfg      Config
	inflight inflight
}

// New builds the proxy handler.
func New(cfg Config) *Handler {
	if cfg.Scanner == nil {
		cfg.Scanner = NoopScanner{}
	}
	if cfg.Client == nil {
		cfg.Client = NewUpstreamClient(true)
	}
	if cfg.Tracer == nil {
		cfg.Tracer = otel.Tracer("github.com/langwatch/langwatch/services/aigateway/adapters/a2aproxy")
	}
	return &Handler{cfg: cfg}
}

// call is one proxied request as it moves through the stages.
type call struct {
	w      http.ResponseWriter
	r      *http.Request
	ctx    context.Context
	span   trace.Span
	bundle *domain.Bundle
	name   string
	// rest is the path after the target, escaped as the caller sent it.
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
	if b := h.cfg.Bundle(r.Context()); b != nil {
		if !h.inflight.acquire(b.VirtualKeyID) {
			busy := &call{w: w, binding: bindingHTTPJSON, span: trace.SpanFromContext(r.Context())}
			busy.refuse(refuseBusy)
			return
		}
		defer h.inflight.release(b.VirtualKeyID)
	}
	c, bad := parseCall(w, r)
	c.bundle = h.cfg.Bundle(c.ctx)
	if c.bundle == nil {
		c.refuse(refuseUnauthenticated)
		return
	}
	ctx, span := h.cfg.Tracer.Start(spanParent(c), "invoke_agent "+c.name,
		trace.WithSpanKind(trace.SpanKindClient), trace.WithAttributes(spanAttrs(c)...))
	defer span.End()
	c.ctx, c.span = ctx, span
	if bad != nil {
		c.refuse(*bad)
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

// parseCall reads the target, binding, method and body. It returns the
// refusal for a request that cannot be read as A2A.
func parseCall(w http.ResponseWriter, r *http.Request) (*call, *refusal) {
	c := &call{w: w, r: r, ctx: r.Context(), binding: bindingHTTPJSON, span: trace.SpanFromContext(context.Background())}
	name, rest, decoded, pathErr := splitPath(r)
	c.name, c.rest = name, rest
	c.isCard = decoded == cardPath && r.Method == http.MethodGet
	method, known := restMethod(r.Method, decoded)
	c.method = method
	if (decoded == "" || decoded == "/") && r.Method == http.MethodPost {
		c.binding, known = bindingJSONRPC, true
	}
	if pathErr != nil {
		return c, &refuseInvalidRequest
	}
	if !known {
		return c, &refuseUnsupported
	}
	body, tooLarge, err := readLimited(r.Body)
	c.body = body
	if tooLarge {
		return c, &refuseTooLarge
	}
	if err != nil {
		return c, &refuseInvalidRequest
	}
	if c.binding != bindingJSONRPC {
		return c, nil
	}
	var env struct {
		ID     json.RawMessage `json:"id"`
		Method string          `json:"method"`
	}
	if json.Unmarshal(body, &env) != nil {
		return c, &refuseInvalidRequest
	}
	c.id, c.method = env.ID, env.Method
	return c, nil
}

// readLimited reads at most maxBodyBytes. A body over the limit is reported,
// never returned cut, so a truncated payload is neither scanned nor relayed.
func readLimited(r io.Reader) (body []byte, tooLarge bool, err error) {
	if r == nil {
		return nil, false, nil
	}
	body, err = io.ReadAll(io.LimitReader(r, maxBodyBytes+1))
	if len(body) > maxBodyBytes {
		return nil, true, nil
	}
	return body, false, err
}

// spanParent is the caller's trace: the traceparent the customer trace
// middleware kept, or the request's own header. A gateway-internal span on
// the context is never the parent, so the hop's trace is the caller's alone.
func spanParent(c *call) context.Context {
	tp := customertracebridge.TraceParent(c.ctx)
	if tp == "" {
		tp = c.r.Header.Get("Traceparent")
	}
	carrier := propagation.MapCarrier{"traceparent": tp}
	sc := trace.SpanContextFromContext(propagation.TraceContext{}.Extract(context.Background(), carrier))
	if sc.IsValid() {
		return trace.ContextWithRemoteSpanContext(c.ctx, sc)
	}
	return trace.ContextWithSpanContext(c.ctx, trace.SpanContext{})
}

func spanAttrs(c *call) []attribute.KeyValue {
	attrs := []attribute.KeyValue{
		attribute.String(attrOperationName, "invoke_agent"),
		attribute.String(attrBinding, c.binding),
		attribute.String(attrMethod, c.method),
		attribute.String(attrTarget, c.name),
		attribute.String(attrCallerVK, c.bundle.VirtualKeyID),
	}
	if pid := c.bundle.Config.TraceProjectID; pid != "" {
		attrs = append(attrs, attribute.String(attrProjectID, pid))
	}
	if caller := c.r.Header.Get(CallerAgentHeader); caller != "" {
		attrs = append(attrs, attribute.String(attrCallerAgentName, caller))
	}
	return attrs
}

// admit finds the target and applies its block switch and allow list.
func (h *Handler) admit(c *call) (domain.A2ATarget, bool) {
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
	if !h.scan(c, DirectionRequest, c.body) {
		return
	}
	req, err := newUpstreamRequest(c, target)
	if err != nil {
		c.refuse(refuseUpstream.withMessage("the A2A agent URL is invalid"))
		return
	}
	resp, err := h.cfg.Client.Do(req)
	if err != nil {
		c.refuse(upstreamRefusal(err))
		return
	}
	defer func() { _ = resp.Body.Close() }()

	if strings.HasPrefix(resp.Header.Get("Content-Type"), "text/event-stream") {
		h.stream(c, resp)
		return
	}
	respBody, tooLarge, err := readLimited(resp.Body)
	if tooLarge {
		c.refuse(refuseReplyTooLarge)
		return
	}
	if err != nil {
		c.refuse(refuseUpstream.withMessage("the A2A agent reply was cut off"))
		return
	}
	setResultAttrs(c.span, respBody)
	if !h.scan(c, DirectionResponse, respBody) {
		return
	}
	if c.method == "GetExtendedAgentCard" {
		respBody = rewriteReplyCard(respBody, strings.TrimSuffix(target.UpstreamURL, "/"), proxyBase(c.r, target.Name))
	}
	copyHeader(c.w.Header(), resp.Header)
	c.w.WriteHeader(resp.StatusCode)
	_, _ = c.w.Write(respBody)
}

// upstreamRefusal names why the upstream call failed when the cause is the
// proxy's own egress policy.
func upstreamRefusal(err error) refusal {
	switch {
	case errors.Is(err, errRedirectRefused):
		return refuseUpstream.withMessage(errRedirectRefused.Error())
	case errors.Is(err, errAddressBlocked):
		return refuseUpstream.withMessage(errAddressBlocked.Error())
	}
	return refuseUpstream
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

// check returns the refusal the body calls for. It reads the body only when
// the key scans this direction; then a body that is not JSON is refused (fail
// closed). A scan error follows the key's fail-open setting.
func (h *Handler) check(c *call, dir Direction, body []byte) *refusal {
	if !h.cfg.Scanner.Applies(c.bundle, dir) {
		return nil
	}
	p := collectTexts(body)
	if !p.parsed {
		if dir == DirectionResponse {
			return &refuseReplyUnscannable
		}
		return &refuseUnscannable
	}
	if len(p.texts) == 0 {
		return nil
	}
	verdict, err := h.cfg.Scanner.Scan(c.ctx, ScanInput{Bundle: c.bundle, Direction: dir, Texts: p.texts})
	if err != nil {
		return h.scanFailed(c, dir)
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

// scanFailed applies the key's fail-open setting for that direction.
func (h *Handler) scanFailed(c *call, dir Direction) *refusal {
	failOpen := c.bundle.Config.Guardrails.RequestFailOpen
	if dir == DirectionResponse {
		failOpen = c.bundle.Config.Guardrails.ResponseFailOpen
	}
	if !failOpen {
		return &refuseScanUnavailable
	}
	c.span.SetAttributes(attribute.Bool("langwatch.a2a.scan.failed_open", true))
	return nil
}

// scan refuses the call when check says so and reports whether it may go on.
func (h *Handler) scan(c *call, dir Direction, body []byte) bool {
	if r := h.check(c, dir, body); r != nil {
		c.refuse(*r)
		return false
	}
	return true
}
