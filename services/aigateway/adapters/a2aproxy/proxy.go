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
	"os"
	"strings"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/trace"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/customertracebridge"
	"github.com/langwatch/langwatch/services/aigateway/adapters/egress"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// PathPrefix is where the proxy is mounted on the gateway.
const PathPrefix = "/a2a/"

const (
	maxBodyBytes  = 1 << 20
	maxEventBytes = 1 << 20
	cardPath      = "/.well-known/agent-card.json"
	// legacyCardPath is where A2A v0.2 agents publish their card.
	legacyCardPath = "/.well-known/agent.json"
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

// Config wires a Handler.
type Config struct {
	Registry Registry
	// Scanner checks message text. Nil scans nothing.
	Scanner Scanner
	// Bundle reads the authenticated caller from the request context.
	Bundle func(context.Context) *domain.Bundle
	// Client calls the upstream. Nil blocks local addresses.
	Client *http.Client
	// RateLimit checks the key's rate limits. Nil checks none.
	RateLimit func(ctx context.Context, vkID string, limits domain.RateLimits) error
	// BudgetPrecheck checks the key's budgets. Nil checks none; an error
	// admits the call, as on the LLM routes.
	BudgetPrecheck func(ctx context.Context, bundle *domain.Bundle) (domain.BudgetDecision, error)
	// RequireHTTPS refuses targets whose upstream, or Agent Card URL for a
	// card fetch, is not https.
	RequireHTTPS bool
	// PublicBaseURL is the gateway's public origin for Agent Card URLs.
	// Empty refuses Agent Card calls: the request's Host is the caller's to set.
	PublicBaseURL string
	// Tracer records the hop: the customer trace bridge's tracer, so the span
	// lands in the caller's project. Nil uses the global tracer provider.
	Tracer trace.Tracer
	// Logger records why a refusal caused by an error happened. Nil logs nothing.
	Logger *zap.Logger
	// RequestBodyTimeout bounds reading the caller's body. Zero is one minute.
	RequestBodyTimeout time.Duration
	// ReplyBodyTimeout bounds reading a reply that is not a stream, from its
	// headers on. Zero is two minutes; a stream has no such bound.
	ReplyBodyTimeout time.Duration
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
		cfg.Client = NewUpstreamClient(UpstreamPolicy{BlockLocal: true})
	}
	if cfg.Tracer == nil {
		cfg.Tracer = otel.Tracer("github.com/langwatch/langwatch/services/aigateway/adapters/a2aproxy")
	}
	if cfg.Logger == nil {
		cfg.Logger = zap.NewNop()
	}
	if cfg.RequestBodyTimeout <= 0 {
		cfg.RequestBodyTimeout = time.Minute
	}
	if cfg.ReplyBodyTimeout <= 0 {
		cfg.ReplyBodyTimeout = 2 * time.Minute
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
	// cardPath is the discovery path a card request named, v1.0 or v0.2.
	cardPath string
	id       json.RawMessage
	body     []byte
	// refusedReason is set once the call has been refused.
	refusedReason string
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	c := &call{w: w, r: r, ctx: r.Context(), binding: bindingHTTPJSON, span: trace.SpanFromContext(context.Background())}
	// The deadline stays when the body is not read whole, so the server's own
	// read of what is left cannot wait on a stalled caller either.
	rc := http.NewResponseController(w)
	_ = rc.SetReadDeadline(time.Now().Add(h.cfg.RequestBodyTimeout))
	bad := parseRoute(c)
	c.bundle = h.cfg.Bundle(c.ctx)
	if c.bundle != nil {
		if !h.inflight.acquire(c.bundle.VirtualKeyID) {
			if c.binding == bindingJSONRPC {
				c.id = peekRequestID(c.r.Body)
			}
			c.refuse(refuseBusy)
			return
		}
		defer h.inflight.release(c.bundle.VirtualKeyID)
	}
	if bad == nil {
		bad = parseBody(c)
	}
	if bad == nil {
		_ = rc.SetReadDeadline(time.Time{})
	}
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
	if servesCard(c) && h.cfg.PublicBaseURL == "" {
		c.refuse(refusePublicURLUnset)
		return
	}
	if !h.withinLimits(c) {
		return
	}
	if c.isCard {
		h.serveCard(c, target)
		return
	}
	h.forward(c, target)
}

// parseBody reads the body and, for JSON-RPC, its id and method. It returns
// the refusal for a body that cannot be read as A2A.
func parseBody(c *call) *refusal {
	body, tooLarge, err := readLimited(c.r.Body)
	c.body = body
	if tooLarge {
		return &refuseTooLarge
	}
	if errors.Is(err, os.ErrDeadlineExceeded) {
		return &refuseBodyTimeout
	}
	if err != nil {
		return &refuseInvalidRequest
	}
	if c.binding != bindingJSONRPC {
		return nil
	}
	return parseJSONRPC(c)
}

// parseRoute fills the target, binding and REST method from the path. It
// returns the refusal for a path that is invalid or names no A2A method. A
// path that fails to split keeps the HTTP+JSON binding.
func parseRoute(c *call) *refusal {
	r := c.r
	name, rest, decoded, pathErr := splitPath(r)
	c.name, c.rest = name, rest
	if pathErr != nil {
		return &refuseInvalidPath
	}
	c.isCard = (decoded == cardPath || decoded == legacyCardPath) && r.Method == http.MethodGet
	if c.isCard {
		c.cardPath = decoded
	}
	method, known := restMethod(r.Method, decoded, rest)
	c.method = method
	if (decoded == "" || decoded == "/") && r.Method == http.MethodPost {
		c.binding, known = bindingJSONRPC, true
	}
	if !known {
		return &refuseUnsupported
	}
	return nil
}

// parseJSONRPC reads the JSON-RPC id and method from the body, by the exact
// member names the upstream reads, so the method checked is the one it runs.
func parseJSONRPC(c *call) *refusal {
	members, ok := readEnvelope(c.body)
	if !ok {
		return &refuseInvalidRequest
	}
	var method string
	if raw, has := members["method"]; has && json.Unmarshal(raw, &method) != nil {
		return &refuseInvalidRequest
	}
	c.id, c.method = members["id"], method
	if !jsonRPCMethods[method] {
		return &refuseUnsupported
	}
	return nil
}

// envelopeMembers are the members of a JSON-RPC 2.0 request.
var envelopeMembers = []string{"jsonrpc", "method", "params", "id"}

// readEnvelope reads the top-level members of one JSON object by their exact
// names. A repeated name, or one equal to an envelope member only when case
// is ignored, fails: parsers disagree on which copy wins (encoding/json folds
// case and keeps the last), so the gateway and the upstream could differ.
func readEnvelope(body []byte) (map[string]json.RawMessage, bool) {
	dec := json.NewDecoder(bytes.NewReader(body))
	if tok, err := dec.Token(); err != nil || tok != json.Delim('{') {
		return nil, false
	}
	members := map[string]json.RawMessage{}
	for dec.More() {
		if !readMember(dec, members) {
			return nil, false
		}
	}
	if _, err := dec.Token(); err != nil { // the closing brace
		return nil, false
	}
	if _, err := dec.Token(); !errors.Is(err, io.EOF) {
		return nil, false
	}
	return members, true
}

// readMember reads one member into members, keeping the value of method and
// id only. It fails on a name readEnvelope refuses.
func readMember(dec *json.Decoder, members map[string]json.RawMessage) bool {
	tok, err := dec.Token()
	name, isName := tok.(string)
	_, repeated := members[name]
	if err != nil || !isName || repeated || foldsToEnvelopeMember(name) {
		return false
	}
	var value json.RawMessage
	target := any(&value)
	if name != "method" && name != "id" {
		target = &skippedValue{}
	}
	if dec.Decode(target) != nil {
		return false
	}
	members[name] = value
	return true
}

// skippedValue reads past a member value without keeping a copy of it.
type skippedValue struct{}

func (*skippedValue) UnmarshalJSON([]byte) error { return nil }

// foldsToEnvelopeMember reports whether name is an envelope member in another
// case, by the Unicode folding encoding/json applies (so "jſonrpc" counts).
func foldsToEnvelopeMember(name string) bool {
	for _, m := range envelopeMembers {
		if name != m && strings.EqualFold(name, m) {
			return true
		}
	}
	return false
}

// maxPeekIDBytes bounds how much of a refused body is read for its id, so a
// key over its in-flight limit cannot hold memory with the refusals.
const maxPeekIDBytes = 64 << 10

// peekRequestID reads the JSON-RPC id from the start of a body, by the
// envelope's own member rules, or nothing when the id does not come within
// maxPeekIDBytes.
func peekRequestID(r io.Reader) json.RawMessage {
	if r == nil {
		return nil
	}
	dec := json.NewDecoder(io.LimitReader(r, maxPeekIDBytes))
	if tok, err := dec.Token(); err != nil || tok != json.Delim('{') {
		return nil
	}
	members := map[string]json.RawMessage{}
	for dec.More() && readMember(dec, members) {
		if id, ok := members["id"]; ok {
			return id
		}
	}
	return nil
}

// errReplyStalled is a reply body that did not arrive within ReplyBodyTimeout.
var errReplyStalled = errors.New("the A2A agent reply body did not arrive within the reply body timeout")

// readReply reads a reply that is not a stream with readLimited. When the body
// takes longer than ReplyBodyTimeout it calls cancel, which ends the upstream call.
func (h *Handler) readReply(body io.Reader, cancel context.CancelFunc) ([]byte, bool, error) {
	timer := time.AfterFunc(h.cfg.ReplyBodyTimeout, cancel)
	raw, tooLarge, err := readLimited(body)
	if !timer.Stop() && err != nil {
		err = fmt.Errorf("%w: %w", errReplyStalled, err)
	}
	return raw, tooLarge, err
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
		// The control plane leaves such targets out of the key's bundle, so
		// both paths answer the same and the target's existence stays hidden.
		c.refuse(refuseTargetNotFound)
		return target, false
	case domain.A2AAllowed:
	}
	plainCard := c.isCard && target.CardURL != "" && !isHTTPS(target.CardURL)
	if h.cfg.RequireHTTPS && (!isHTTPS(target.UpstreamURL) || plainCard) {
		c.refuse(refuseNotHTTPS)
		return target, false
	}
	return target, true
}

// withinLimits applies the key's rate limits and budgets, as the LLM routes
// do. Every card fetch, call and stream counts as one request.
func (h *Handler) withinLimits(c *call) bool {
	if h.cfg.RateLimit != nil && h.cfg.RateLimit(c.ctx, c.bundle.VirtualKeyID, c.bundle.Config.RateLimits) != nil {
		c.refuse(refuseRateLimited)
		return false
	}
	if h.cfg.BudgetPrecheck == nil {
		return true
	}
	decision, err := h.cfg.BudgetPrecheck(c.ctx, c.bundle)
	if err == nil && decision.Verdict == domain.BudgetBlock {
		c.refuse(refuseBudgetExceeded)
		return false
	}
	return true
}

func (h *Handler) forward(c *call, target domain.A2ATarget) {
	setMessageAttrs(c.span, c.body)
	if !h.scan(c, DirectionRequest, c.body) {
		return
	}
	ctx, cancel := context.WithCancel(c.ctx)
	defer cancel()
	req, err := newUpstreamRequest(ctx, c, target)
	if err != nil {
		c.refuse(refuseUpstream.withMessage("the A2A agent URL is invalid"))
		return
	}
	resp, err := h.cfg.Client.Do(req)
	if err != nil {
		h.refuseUpstreamFailure(c, err)
		return
	}
	defer func() { _ = resp.Body.Close() }()

	if isEventStream(resp.Header.Get("Content-Type")) {
		h.stream(c, resp)
		return
	}
	respBody, tooLarge, err := h.readReply(resp.Body, cancel)
	if tooLarge {
		c.refuse(refuseReplyTooLarge)
		return
	}
	if err != nil {
		h.refuseWithCause(c, refuseUpstream.withMessage("the A2A agent reply was cut off"), err)
		return
	}
	setResultAttrs(c.span, respBody)
	if !h.scan(c, DirectionResponse, respBody) {
		return
	}
	// Only a successful reply carries a card; any other is relayed as it came.
	if isExtendedCardMethod(c.method) && resp.StatusCode >= 200 && resp.StatusCode < 300 {
		respBody = rewriteReplyCard(respBody, target.UpstreamURL, proxyBase(h.cfg.PublicBaseURL, target.Name))
	}
	copyHeader(c.w.Header(), resp.Header)
	c.w.WriteHeader(resp.StatusCode)
	_, _ = c.w.Write(respBody)
}

// isExtendedCardMethod reports whether a method asks for the extended Agent Card.
func isExtendedCardMethod(method string) bool {
	return method == "GetExtendedAgentCard" || method == "agent/getAuthenticatedExtendedCard"
}

// servesCard reports whether the call answers with an Agent Card.
func servesCard(c *call) bool {
	return c.isCard || isExtendedCardMethod(c.method)
}

// refuseUpstreamFailure refuses a call whose upstream request failed, naming the
// cause to the caller only when it is the proxy's own egress policy.
func (h *Handler) refuseUpstreamFailure(c *call, err error) {
	r := refuseUpstream
	switch {
	case errors.Is(err, errRedirectRefused):
		r = r.withMessage(errRedirectRefused.Error())
	case errors.Is(err, egress.ErrBlocked):
		r = r.withMessage(errAddressBlocked.Error())
	}
	h.refuseWithCause(c, r, err)
}

func newUpstreamRequest(ctx context.Context, c *call, target domain.A2ATarget) (*http.Request, error) {
	upstreamURL := upstreamEndpoint(target.UpstreamURL, c.rest, c.r.URL.RawQuery)
	req, err := http.NewRequestWithContext(ctx, c.r.Method, upstreamURL, bytes.NewReader(c.body))
	if err != nil {
		return nil, err
	}
	hopByHop := connectionFields(c.r.Header)
	for _, name := range forwardedHeaders {
		if v := c.r.Header.Get(name); v != "" && !hopByHop[http.CanonicalHeaderKey(name)] {
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
	return h.checkTexts(c, dir, p.texts)
}

// checkTexts sends the texts to the scanner and maps a deny to a refusal.
func (h *Handler) checkTexts(c *call, dir Direction, texts []string) *refusal {
	if len(texts) == 0 {
		return nil
	}
	verdict, err := h.cfg.Scanner.Scan(c.ctx, ScanInput{Bundle: c.bundle, Direction: dir, Texts: texts})
	if err != nil {
		return h.scanFailed(c, dir, err)
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

// scanFailed applies the key's fail-open setting for that direction. Stream
// chunks always fail open, as on the LLM routes. The cause goes to the hop
// span and the log either way, never to the caller.
func (h *Handler) scanFailed(c *call, dir Direction, cause error) *refusal {
	var failOpen bool
	switch dir {
	case DirectionRequest:
		failOpen = c.bundle.Config.Guardrails.RequestFailOpen
	case DirectionResponse:
		failOpen = c.bundle.Config.Guardrails.ResponseFailOpen
	case DirectionStreamChunk:
		failOpen = true
	}
	if !failOpen {
		h.recordCause(c, refuseScanUnavailable.reason, cause)
		return &refuseScanUnavailable
	}
	h.cfg.Logger.Warn("a2a_scan_fail_open", zap.String("direction", string(dir)),
		zap.String("a2a.target", c.name), zap.Error(cause))
	c.span.SetAttributes(attribute.Bool("langwatch.a2a.scan.failed_open", true))
	c.span.AddEvent("a2a_scan_fail_open", trace.WithAttributes(
		attribute.String("langwatch.guardrail.direction", string(dir)),
		attribute.String("langwatch.guardrail.cause", cause.Error()),
	))
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
