package otelrelay

import (
	"bytes"
	"context"
	"crypto/rand"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/tidwall/gjson"
	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/ptrace"
	"go.opentelemetry.io/otel/trace"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/clog"
	"github.com/langwatch/langwatch/pkg/contexts"
	"github.com/langwatch/langwatch/pkg/customertracebridge"
	"github.com/langwatch/langwatch/pkg/otelsetup"
)

// The worker exports no OTLP: the wrapper is a thin stdio process and pi
// itself ships no exporter. Every one of its LLM calls still crosses THIS
// proxy, so the relay retells each call as one gen_ai span into the customer's
// trace, model from the manager-held config, token usage read from the
// response as it streams through untouched, parent = the turn span.
//
// The gateway's own gen_ai span (joined via the injected traceparent) remains
// the authoritative METER for tokens and cost, so the synthesized span carries
// the skip-token-accumulation stamp and its usage attributes are descriptive,
// never double-counted.

// maxGenAIJSONBodyBytes caps how much of a non-streaming response body the
// usage scanner accumulates. Usage rides a small trailing object; a body past
// the cap simply yields a span without usage.
const maxGenAIJSONBodyBytes = 256 * 1024

// genAIUsagePaths are the usage field spellings across the three lanes the
// worker can run: OpenAI chat completions (prompt/completion_tokens, in the
// body or the final stream chunk), the Responses API (input/output_tokens
// under response.usage on the response.completed event), and Anthropic
// messages (input_tokens on message_start under message.usage, cumulative
// output_tokens on message_delta under a bare usage).
//
// The cache paths follow the same lanes: Anthropic states cache reads and
// writes next to input_tokens (message_start on the stream, a bare usage on
// the non-stream body), with the hour-long share of the writes nested under
// usage.cache_creation; OpenAI reports only reads, as cached_tokens under
// prompt_tokens_details (chat) or input_tokens_details (responses).
var (
	genAIInputTokenPaths = []string{
		"usage.input_tokens",
		"usage.prompt_tokens",
		"response.usage.input_tokens",
		"message.usage.input_tokens",
	}
	genAIOutputTokenPaths = []string{
		"usage.output_tokens",
		"usage.completion_tokens",
		"response.usage.output_tokens",
		"message.usage.output_tokens",
	}
	genAICacheReadTokenPaths = []string{
		"usage.cache_read_input_tokens",
		"usage.prompt_tokens_details.cached_tokens",
		"usage.input_tokens_details.cached_tokens",
		"response.usage.input_tokens_details.cached_tokens",
		"message.usage.cache_read_input_tokens",
	}
	genAICacheCreationTokenPaths = []string{
		"usage.cache_creation_input_tokens",
		"message.usage.cache_creation_input_tokens",
	}
	genAICacheCreation1hTokenPaths = []string{
		"usage.cache_creation.ephemeral_1h_input_tokens",
		"message.usage.cache_creation.ephemeral_1h_input_tokens",
	}
)

// genAICall observes one mediated LLM call for a pi worker and, when the
// response body finishes, forwards the synthesized span. Created per call in
// handleLLM; observeResponse wraps the outgoing body so scanning happens on
// the bytes already flowing to the worker, the response is never buffered or
// delayed.
type genAICall struct {
	relay *Relay
	entry *workerEntry
	turn  trace.SpanContext
	op    string
	start time.Time

	status int
	// paramsDropped is the gateway's own statement of which request options
	// it removed before dispatch (the X-LangWatch-Params-Dropped header).
	// Two production outages were invisible until a live probe because
	// nothing langy-side recorded what the gateway dropped; carried onto the
	// retold span so the next field pi starts sending shows up on the first
	// turn, not as a dead card in production.
	paramsDropped string
	// isTransportFailure marks a call the proxy could never deliver (dial
	// failure, upstream reset). No response ever arrives, so observeResponse
	// never runs and the span has to be closed from the proxy's ErrorHandler.
	isTransportFailure bool

	// Body scanning state. Reads are sequential per response body, so no lock.
	sse                   bool
	line                  []byte
	lineOverflow          bool
	jsonBody              []byte
	inputTokens           int64
	outputTokens          int64
	cacheReadTokens       int64
	cacheCreationTokens   int64
	cacheCreation1hTokens int64

	finishOnce sync.Once
}

// newGenAICall returns the observer for one call, or nil when no span should
// be synthesized: an invalid turn context (nothing to parent under), or a
// non-generation request (only POSTs carry model calls).
func newGenAICall(r *Relay, entry *workerEntry, req *http.Request) *genAICall {
	if req.Method != http.MethodPost {
		return nil
	}
	turn := entry.turnContext()
	if !turn.IsValid() {
		return nil
	}
	return &genAICall{
		relay: r,
		entry: entry,
		turn:  turn,
		op:    genAIOperation(req.URL.Path),
		start: time.Now(),
	}
}

// genAIOperation names the lane from the request path suffix.
func genAIOperation(path string) string {
	switch {
	case strings.HasSuffix(path, "/chat/completions"):
		return "chat"
	case strings.HasSuffix(path, "/messages"):
		return "messages"
	case strings.HasSuffix(path, "/responses"):
		return "responses"
	default:
		return "llm"
	}
}

// observeResponse wraps the response body so usage is scanned as the bytes
// stream through and the span is emitted when the body ends. Wraps whatever
// body captureLLMFailure left in place (its sniffer or the re-chained error
// body), so both observations ride the same single pass.
func (g *genAICall) observeResponse(resp *http.Response) {
	g.status = resp.StatusCode
	g.sse = strings.HasPrefix(resp.Header.Get("Content-Type"), "text/event-stream")
	if dropped := resp.Header.Get(paramsDroppedHeader); dropped != "" {
		g.paramsDropped = dropped
		if g.entry.noteParamsDropped(dropped) {
			clog.Get(g.relay.baseCtx).Info("gateway dropped params from a langy model call",
				zap.String("conversation", g.entry.info.ConversationID),
				zap.String("model", g.entry.info.Model),
				zap.String("params_dropped", dropped))
		}
	}
	resp.Body = &genAIBody{call: g, body: resp.Body}
}

// paramsDroppedHeader is the gateway's drop signal: the request options the
// parameter policy removed before dispatch, comma separated.
const paramsDroppedHeader = "X-LangWatch-Params-Dropped"

// genAIBody is the pass-through reader: scan on Read, finish on EOF or Close
// (whichever lands first, Close always does, ReverseProxy closes the body).
type genAIBody struct {
	call *genAICall
	body io.ReadCloser
}

func (b *genAIBody) Read(p []byte) (int, error) {
	n, err := b.body.Read(p)
	if n > 0 {
		b.call.scan(p[:n])
	}
	if err == io.EOF {
		b.call.finish()
	}
	return n, err
}

func (b *genAIBody) Close() error {
	b.call.finish()
	return b.body.Close()
}

// scan feeds response bytes into the usage extractor: SSE bodies are scanned
// line-wise for usage-bearing data events; JSON bodies accumulate (bounded)
// and are parsed once at finish.
func (g *genAICall) scan(chunk []byte) {
	if !g.sse {
		if len(g.jsonBody) < maxGenAIJSONBodyBytes {
			room := maxGenAIJSONBodyBytes - len(g.jsonBody)
			if room > len(chunk) {
				room = len(chunk)
			}
			g.jsonBody = append(g.jsonBody, chunk[:room]...)
		}
		return
	}
	for len(chunk) > 0 {
		nl := bytes.IndexByte(chunk, '\n')
		if nl < 0 {
			g.bufferLine(chunk)
			return
		}
		g.bufferLine(chunk[:nl])
		if !g.lineOverflow {
			g.inspectSSELine(bytes.TrimSuffix(g.line, []byte("\r")))
		}
		g.line = g.line[:0]
		g.lineOverflow = false
		chunk = chunk[nl+1:]
	}
}

func (g *genAICall) bufferLine(part []byte) {
	if g.lineOverflow {
		return
	}
	if len(g.line)+len(part) > maxErrorBodyBytes {
		g.lineOverflow = true
		g.line = g.line[:0]
		return
	}
	g.line = append(g.line, part...)
}

func (g *genAICall) inspectSSELine(line []byte) {
	payload, ok := bytes.CutPrefix(line, sseDataLinePrefix)
	if !ok || !bytes.Contains(payload, []byte(`"usage"`)) {
		return
	}
	g.takeUsage(payload)
}

// takeUsage reads the usage fields out of one JSON payload. Latest non-zero
// wins per field: the counters are totals (or cumulative on the Anthropic
// stream), so the newest observation is the closest to final. The same rule
// keeps the cache counts intact across the Anthropic stream, matching the
// gateway's own merge: message_start carries the input-side counters
// including the cache breakdown, message_delta re-states only output_tokens,
// and an absent field never overwrites a captured one.
func (g *genAICall) takeUsage(payload []byte) {
	takeTokenCount(payload, genAIInputTokenPaths, &g.inputTokens)
	takeTokenCount(payload, genAIOutputTokenPaths, &g.outputTokens)
	takeTokenCount(payload, genAICacheReadTokenPaths, &g.cacheReadTokens)
	takeTokenCount(payload, genAICacheCreationTokenPaths, &g.cacheCreationTokens)
	takeTokenCount(payload, genAICacheCreation1hTokenPaths, &g.cacheCreation1hTokens)
}

// takeTokenCount stores the first non-zero number found at paths into dst,
// leaving dst untouched when no path matches.
func takeTokenCount(payload []byte, paths []string, dst *int64) {
	for _, path := range paths {
		if v := gjson.GetBytes(payload, path); v.Type == gjson.Number && v.Int() > 0 {
			*dst = v.Int()
			return
		}
	}
}

// finishTransportError closes the span for a call that got no response at all.
// The default status is 0, which forwardSpan records as Ok, so the failure is
// stamped before the finish. The error's own text stays out of the customer's
// trace: it names manager-side hosts, and the file's rule is bounded
// classification, never upstream prose.
func (g *genAICall) finishTransportError() {
	g.status = http.StatusBadGateway
	g.isTransportFailure = true
	g.finish()
}

// finish builds and forwards the span, exactly once.
func (g *genAICall) finish() {
	g.finishOnce.Do(func() {
		if !g.sse && len(g.jsonBody) > 0 {
			g.takeUsage(g.jsonBody)
		}
		g.forwardSpan()
	})
}

// forwardSpan emits the synthesized gen_ai span into the customer's project
// through the same policy pass + forward pipeline every relayed batch takes.
// Detached and best-effort like every telemetry leg: a failure warns and bumps
// the forward-failure counter, never the call.
func (g *genAICall) forwardSpan() {
	spanID, ok := randomSpanID()
	if !ok {
		return
	}
	end := time.Now()
	info := g.entry.info

	td := ptrace.NewTraces()
	rs := td.ResourceSpans().AppendEmpty()
	stampResource(rs.Resource().Attributes(), info.ConversationID, info.ActorUserID)
	ss := rs.ScopeSpans().AppendEmpty()
	// The manager authors this span (the worker exports nothing), same scope
	// identity as the turn span.
	ss.Scope().SetName("langy-agent")
	if svc := contexts.GetServiceInfo(g.relay.baseCtx); svc != nil {
		ss.Scope().SetVersion(svc.Version)
	}
	span := ss.Spans().AppendEmpty()
	span.SetName("gen_ai." + g.op)
	span.SetKind(ptrace.SpanKindClient)
	span.SetTraceID(pcommon.TraceID(g.turn.TraceID()))
	span.SetParentSpanID(pcommon.SpanID(g.turn.SpanID()))
	span.SetSpanID(spanID)
	span.SetStartTimestamp(pcommon.NewTimestampFromTime(g.start))
	span.SetEndTimestamp(pcommon.NewTimestampFromTime(end))
	span.Attributes().PutStr(otelsetup.AttrLangWatchOrigin, originLangy)
	span.Attributes().PutStr(attrGenAIConversationID, info.ConversationID)
	span.Attributes().PutStr("gen_ai.operation.name", g.op)
	// The manager-held, provider-prefixed model id, never anything read from
	// the request body, which is worker-authored.
	if info.Model != "" {
		span.Attributes().PutStr("gen_ai.request.model", info.Model)
	}
	if g.inputTokens > 0 {
		span.Attributes().PutInt("gen_ai.usage.input_tokens", g.inputTokens)
	}
	if g.outputTokens > 0 {
		span.Attributes().PutInt("gen_ai.usage.output_tokens", g.outputTokens)
	}
	// Cache usage rides the same attribute names the gateway's customer span
	// uses, so downstream canonicalisation reads both spans identically.
	if g.cacheReadTokens > 0 {
		span.Attributes().PutInt(customertracebridge.AttrGenAIUsageCacheRead, g.cacheReadTokens)
	}
	if g.cacheCreationTokens > 0 {
		span.Attributes().PutInt(customertracebridge.AttrGenAIUsageCacheCreate, g.cacheCreationTokens)
	}
	if g.cacheCreation1hTokens > 0 {
		span.Attributes().PutInt(customertracebridge.AttrGenAIUsageCacheCreate1h, g.cacheCreation1hTokens)
	}
	if g.paramsDropped != "" {
		span.Attributes().PutStr("langwatch.langy.params_dropped", g.paramsDropped)
	}
	// The gateway's gen_ai span is the meter for this same call; the retold
	// copy is structure, not a second bill.
	span.Attributes().PutStr(attrSkipTokenAccumulation, "true")
	if strings.HasPrefix(info.Model, codexModelPrefix) {
		span.Attributes().PutStr(attrCostNonBillable, "true")
	}
	if g.isTransportFailure {
		span.Attributes().PutStr("error.type", "transport_error")
	}
	if g.status >= 400 {
		span.Status().SetCode(ptrace.StatusCodeError)
	} else {
		span.Status().SetCode(ptrace.StatusCodeOk)
	}
	applyCustomerTracePolicy(td, customerTracePolicy)
	// Platform identity, stamped AFTER the policy pass exactly like the turn
	// span: this is the platform speaking, the one place the reserved name is
	// legitimate.
	rs.Resource().Attributes().PutStr("service.name", "langy")

	payload, err := (&ptrace.ProtoMarshaler{}).MarshalTraces(td)
	if err != nil {
		return
	}
	r := g.relay
	go func() {
		defer clog.HandlePanic(r.baseCtx, false)
		ctx, cancel := context.WithTimeout(r.baseCtx, 10*time.Second)
		defer cancel()
		if err := r.forwardTraces(ctx, info, payload); err != nil && r.baseCtx.Err() == nil {
			r.forwardFailures.Add(r.baseCtx, 1)
			clog.Get(r.baseCtx).Warn("otelrelay synthesized gen_ai span forward failed",
				zap.String("conversation", info.ConversationID),
				zap.Error(err))
		}
	}()
}

// randomSpanID mints a fresh non-zero span id for a synthesized span.
func randomSpanID() (pcommon.SpanID, bool) {
	var id pcommon.SpanID
	for range 4 {
		if _, err := rand.Read(id[:]); err != nil {
			return id, false
		}
		if !id.IsEmpty() {
			return id, true
		}
	}
	return id, false
}
