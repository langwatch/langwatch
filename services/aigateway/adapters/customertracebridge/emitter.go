package customertracebridge

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/tidwall/gjson"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.40.0"
	"go.opentelemetry.io/otel/trace"

	"github.com/langwatch/langwatch/pkg/contexts"
	"github.com/langwatch/langwatch/services/aigateway/adapters/gatewaytracer"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

const (
	attrProjectID      = attribute.Key("langwatch.project_id")
	attrTotalUsage     = attribute.Key("gen_ai.usage.total_tokens")
	attrCost           = attribute.Key("gen_ai.usage.cost")
	attrInputMessages  = attribute.Key("gen_ai.input.messages")
	attrOutputMessages = attribute.Key("gen_ai.output.messages")
	// attrDrop marks a span the gateway started but does not want exported
	// (zero-cost, no-output probe calls). dropFilterExporter omits these.
	attrDrop = attribute.Key("langwatch.reserved.drop")
)

// Emitter uses a private (non-global) OTel TracerProvider to construct spans
// and export them to the customer's OTLP endpoint. The TP has an empty Resource
// so customers only see the instrumentation scope, not the gateway's service identity.
type Emitter struct {
	tp         *sdktrace.TracerProvider
	tracer     trace.Tracer
	propagator propagation.TextMapPropagator
}

// dropFilterExporter omits spans the emitter marked with attrDrop (zero-cost,
// no-output probe calls) before they reach the customer's OTLP endpoint. The
// span is still started + ended in-process (so there is no span leak); it is
// simply not exported. Keeping the decision at export time avoids fighting the
// OTel span lifecycle, which has no way to cancel an already-started span.
type dropFilterExporter struct {
	inner sdktrace.SpanExporter
}

func (d dropFilterExporter) ExportSpans(ctx context.Context, spans []sdktrace.ReadOnlySpan) error {
	kept := spans[:0]
	for _, s := range spans {
		drop := false
		for _, a := range s.Attributes() {
			if a.Key == attrDrop && a.Value.AsBool() {
				drop = true
				break
			}
		}
		if !drop {
			kept = append(kept, s)
		}
	}
	if len(kept) == 0 {
		return nil
	}
	return d.inner.ExportSpans(ctx, kept)
}

func (d dropFilterExporter) Shutdown(ctx context.Context) error {
	return d.inner.Shutdown(ctx)
}

// EmitterOptions configures the Emitter.
type EmitterOptions struct {
	Registry     *Registry
	BatchTimeout time.Duration
	MaxQueueSize int
}

// NewEmitter creates a customer trace bridge backed by a private TracerProvider.
func NewEmitter(ctx context.Context, opts EmitterOptions) (*Emitter, error) {
	if opts.Registry == nil {
		opts.Registry = NewRegistry()
	}

	router := dropFilterExporter{inner: newRouterExporter(opts.Registry)}

	batchTimeout := opts.BatchTimeout
	if batchTimeout == 0 {
		batchTimeout = 5 * time.Second
	}
	queueSize := opts.MaxQueueSize
	if queueSize == 0 {
		queueSize = 8192
	}

	// Empty resource — customers see instrumentation scope only.
	// AlwaysSample: the gateway never drops customer spans regardless of
	// the gateway's own sample ratio setting.
	tp := sdktrace.NewTracerProvider(
		sdktrace.WithResource(resource.Empty()),
		sdktrace.WithBatcher(router,
			sdktrace.WithBatchTimeout(batchTimeout),
			sdktrace.WithMaxQueueSize(queueSize),
		),
		sdktrace.WithSampler(sdktrace.AlwaysSample()),
	)

	svcCtx := contexts.MustGetServiceInfo(ctx)

	return &Emitter{
		tp:         tp,
		tracer:     tp.Tracer(fmt.Sprintf("langwatch-%s", svcCtx.Service), trace.WithInstrumentationVersion(svcCtx.Version)),
		propagator: propagation.TraceContext{},
	}, nil
}

// BeginSpan starts a customer-facing span that nests under the customer's
// inbound traceparent. It returns an enriched context (carrying the open span)
// and a W3C traceparent string representing the new span.
func (e *Emitter) BeginSpan(ctx context.Context, projectID string, reqType domain.RequestType) (context.Context, string) {
	tp := TraceParent(ctx)
	spanCtx := e.customerSpanContext(tp)

	//nolint:spancheck // span lifecycle is split across BeginSpan/EndSpan via activeSpan context key by design.
	spanCtx, span := e.tracer.Start(spanCtx, "gen_ai."+string(reqType),
		trace.WithSpanKind(trace.SpanKindClient),
		trace.WithAttributes(
			attrProjectID.String(projectID),
			semconv.GenAIOperationNameKey.String(string(reqType)),
		),
	)

	// Store the span in request context so EndSpan can retrieve it.
	ctx = withActiveSpan(ctx, span)

	// Format the span's context as a W3C traceparent for the response header.
	sc := span.SpanContext()
	traceparent := formatTraceparent(sc)

	_ = spanCtx // span lifecycle managed via activeSpan context key
	//nolint:spancheck // span ends in EndSpan, retrieved via activeSpan context key.
	return ctx, traceparent
}

// EndSpan retrieves the span started by BeginSpan, sets final attributes, and
// ends it. If no span is found in context this is a no-op.
func (e *Emitter) EndSpan(ctx context.Context, params domain.AITraceParams) {
	span := activeSpanFrom(ctx)
	if span == nil {
		return
	}

	// PromptTokens includes any cached tokens; the span reports the fresh,
	// non-cached input separately from the cache-read/cache-write counts so the
	// cost calc prices each bucket once. Fall back to the full prompt if a
	// provider ever reports cache counts that aren't folded into PromptTokens.
	freshInput := params.Usage.PromptTokens - params.Usage.CacheReadTokens - params.Usage.CacheCreationTokens
	if freshInput < 0 {
		freshInput = params.Usage.PromptTokens
	}

	attrs := []attribute.KeyValue{
		semconv.GenAIProviderNameKey.String(string(params.ProviderID)),
		semconv.GenAIRequestModelKey.String(params.Model),
		semconv.GenAIUsageInputTokensKey.Int(freshInput),
		semconv.GenAIUsageOutputTokensKey.Int(params.Usage.CompletionTokens),
		attrTotalUsage.Int(params.Usage.TotalTokens),
		attrCost.Int64(params.Usage.CostMicroUSD),
	}
	if params.Usage.CacheReadTokens > 0 {
		attrs = append(attrs, attribute.Int(gatewaytracer.AttrGenAIUsageCacheRead, params.Usage.CacheReadTokens))
	}
	if params.Usage.CacheCreationTokens > 0 {
		attrs = append(attrs, attribute.Int(gatewaytracer.AttrGenAIUsageCacheCreate, params.Usage.CacheCreationTokens))
	}
	// VK id + request id let the control plane's trace-processing pipeline
	// identify gateway traces and fold idempotent budget debits into ClickHouse.
	// See specs/ai-gateway/_shared/contract.md §4.5.
	if params.VirtualKeyID != "" {
		attrs = append(attrs, attribute.String(gatewaytracer.AttrVirtualKeyID, params.VirtualKeyID))
	}
	if params.GatewayRequestID != "" {
		attrs = append(attrs, attribute.String(gatewaytracer.AttrGatewayReqID, params.GatewayRequestID))
	}
	// The wrapped tool's own session / conversation id, so multi-turn gateway
	// traces group under a stable thread instead of having no thread id at all.
	if sessionID := clientSessionID(ctx, params); sessionID != "" {
		attrs = append(attrs, attribute.String(gatewaytracer.AttrGenAIConversationID, sessionID))
	}

	// When the request failed upstream, stamp the provider's HTTP status +
	// error class so the trace renders as an error instead of silently dropping
	// (previously the span was never ended on error, losing the failure).
	isError := params.UpstreamStatusCode >= 400 || params.UpstreamErrorType != ""
	if params.UpstreamStatusCode >= 400 {
		attrs = append(attrs, semconv.HTTPResponseStatusCodeKey.Int(params.UpstreamStatusCode))
	}
	if params.UpstreamErrorType != "" {
		attrs = append(attrs, semconv.ErrorTypeKey.String(params.UpstreamErrorType))
	}
	span.SetAttributes(attrs...)

	if input := extractInputMessages(params.RequestBody, params.RequestType); input != "" {
		span.SetAttributes(attrInputMessages.String(input))
	}
	output := extractOutputMessages(params.ResponseBody, params.RequestType)
	if output != "" {
		span.SetAttributes(attrOutputMessages.String(output))
	}

	if isError {
		span.SetStatus(codes.Error, params.UpstreamErrorType)
	}

	// Suppress zero-cost, no-output, successful spans: these are claude-code's
	// internal probe calls (system-reminder / skills-list pings) that return no
	// usage and no assistant content, so they'd otherwise clutter the trace list
	// with empty $0 rows. Keep anything with output OR cost OR an error. The
	// drop marker is honored by dropFilterExporter at export time. PATH-A ONLY:
	// Path B (claude-code direct OTLP) does not route through the gateway, so its
	// probes are not affected here.
	if !isError && params.Usage.CompletionTokens == 0 && params.Usage.CostMicroUSD == 0 && output == "" {
		span.SetAttributes(attrDrop.Bool(true))
	}

	span.End()
}

// Shutdown flushes pending spans to customer endpoints.
func (e *Emitter) Shutdown(ctx context.Context) error {
	if e.tp != nil {
		return e.tp.Shutdown(ctx)
	}
	return nil
}

// customerSpanContext builds a context with the customer's trace/span IDs as
// the parent, using a fresh context.Background() — never the request context.
func (e *Emitter) customerSpanContext(traceparent string) context.Context {
	if traceparent == "" {
		// No customer traceparent — span will be a new root trace.
		return context.Background()
	}

	// Use the W3C propagator to extract into a clean context.
	carrier := propagation.MapCarrier{"traceparent": traceparent}
	return e.propagator.Extract(context.Background(), carrier)
}

// formatTraceparent formats a SpanContext as a W3C traceparent header value.
func formatTraceparent(sc trace.SpanContext) string {
	if !sc.IsValid() {
		return ""
	}
	flags := "00"
	if sc.IsSampled() {
		flags = "01"
	}
	return fmt.Sprintf("00-%s-%s-%s", sc.TraceID().String(), sc.SpanID().String(), flags)
}

// parseTraceparent extracts trace ID and parent span ID from a W3C traceparent
// header: "00-<traceID>-<spanID>-<flags>"
func parseTraceparent(tp string) (traceID []byte, spanID []byte) {
	if tp == "" {
		return nil, nil
	}
	parts := strings.Split(tp, "-")
	if len(parts) < 4 {
		return nil, nil
	}
	tid, err := hex.DecodeString(parts[1])
	if err != nil || len(tid) != 16 {
		return nil, nil
	}
	sid, err := hex.DecodeString(parts[2])
	if err != nil || len(sid) != 8 {
		return nil, nil
	}
	return tid, sid
}

// clientSessionID resolves the wrapped tool's own session / conversation id.
// Header first (stashed on the context by the gateway middleware: claude-code
// X-Claude-Code-Session-Id, opencode X-Session-Affinity, codex Session-Id),
// then a request-body fallback for the two tools that also echo it inline so
// the id survives even if a future middleware change stops forwarding the
// header. Empty when the tool sends no per-conversation id on the gateway wire
// (gemini-cli, which only emits its conversation id via direct OTLP / Path B).
func clientSessionID(ctx context.Context, params domain.AITraceParams) string {
	if id := ClientSessionID(ctx); id != "" {
		return id
	}
	switch params.RequestType {
	case domain.RequestTypeMessages:
		// claude-code: body.metadata.user_id is a JSON string carrying session_id.
		if userID := gjson.GetBytes(params.RequestBody, "metadata.user_id").String(); userID != "" {
			if sid := gjson.Get(userID, "session_id").String(); sid != "" {
				return sid
			}
		}
	case domain.RequestTypeResponses:
		// codex: body.prompt_cache_key is the per-session cache key == session id.
		if sid := gjson.GetBytes(params.RequestBody, "prompt_cache_key").String(); sid != "" {
			return sid
		}
	case domain.RequestTypeChat, domain.RequestTypeEmbeddings, domain.RequestTypePassthrough:
		// No inline session id on these request shapes; the header lifted above
		// (when present) is the only source.
	}
	return ""
}

// extractInputMessages returns the JSON-encoded messages array from the request body.
func extractInputMessages(body []byte, reqType domain.RequestType) string {
	if len(body) == 0 {
		return ""
	}
	switch reqType {
	case domain.RequestTypePassthrough:
		// Gemini-native /v1beta bodies carry `contents` not `messages`.
		// Convert to a synthetic chat-completion `messages` shape so the
		// LangWatch trace viewer renders the conversation the same way
		// it does for the OpenAI / Anthropic surfaces.
		return geminiContentsAsMessages(body)
	case domain.RequestTypeResponses:
		// OpenAI Responses API (used by codex): `input` is either a
		// string (single user turn) OR an array of messages. Both shapes
		// are normalised to a chat-style messages array so downstream
		// rendering matches the other surfaces.
		return responsesInputAsMessages(body)
	default:
		r := gjson.GetBytes(body, "messages")
		if !r.Exists() {
			return ""
		}
		return r.Raw
	}
}

// responsesInputAsMessages normalises OpenAI Responses API `input` into
// a chat-style `[{role, content}, …]` array. The Responses API accepts
// `input` as either a bare string ("hello") or as a typed message array
// ([{role:"user", content:[{type:"input_text", text:"..."}]}]). Both
// shapes land here and get flattened to the same renderable form so
// codex traces show the same input cell as OpenAI chat / Anthropic.
func responsesInputAsMessages(body []byte) string {
	input := gjson.GetBytes(body, "input")
	if !input.Exists() {
		return ""
	}
	if input.Type == gjson.String {
		return fmt.Sprintf(`[{"role":"user","content":%q}]`, input.String())
	}
	if !input.IsArray() {
		return ""
	}
	var msgs []string
	input.ForEach(func(_, m gjson.Result) bool {
		role := m.Get("role").String()
		if role == "" {
			role = "user"
		}
		content := m.Get("content")
		if !content.Exists() {
			return true
		}
		if content.Type == gjson.String {
			msgs = append(msgs, fmt.Sprintf(`{"role":%q,"content":%q}`, role, content.String()))
			return true
		}
		if !content.IsArray() {
			return true
		}
		var text strings.Builder
		content.ForEach(func(_, part gjson.Result) bool {
			if t := part.Get("text"); t.Exists() {
				if text.Len() > 0 {
					text.WriteByte('\n')
				}
				text.WriteString(t.String())
			}
			return true
		})
		if text.Len() > 0 {
			msgs = append(msgs, fmt.Sprintf(`{"role":%q,"content":%q}`, role, text.String()))
		}
		return true
	})
	if len(msgs) == 0 {
		return ""
	}
	return "[" + strings.Join(msgs, ",") + "]"
}

// geminiContentsAsMessages flattens Gemini's `systemInstruction` +
// `contents[]` into a chat-style `[{role, content}, …]` array. Gemini's
// roles are "user" / "model"; the latter maps to "assistant" so the
// downstream trace viewer doesn't render an unknown role badge.
func geminiContentsAsMessages(body []byte) string {
	var msgs []string
	if sys := gjson.GetBytes(body, "systemInstruction"); sys.Exists() {
		text := joinGeminiPartsText(sys.Get("parts"))
		if text != "" {
			msgs = append(msgs, fmt.Sprintf(`{"role":"system","content":%q}`, text))
		}
	}
	contents := gjson.GetBytes(body, "contents")
	if !contents.Exists() {
		if len(msgs) == 0 {
			return ""
		}
		return "[" + strings.Join(msgs, ",") + "]"
	}
	contents.ForEach(func(_, v gjson.Result) bool {
		role := v.Get("role").String()
		if role == "model" {
			role = "assistant"
		}
		if role == "" {
			role = "user"
		}
		text := joinGeminiPartsText(v.Get("parts"))
		if text == "" {
			return true
		}
		msgs = append(msgs, fmt.Sprintf(`{"role":%q,"content":%q}`, role, text))
		return true
	})
	if len(msgs) == 0 {
		return ""
	}
	return "[" + strings.Join(msgs, ",") + "]"
}

// joinGeminiPartsText concatenates all `parts[].text` fields, ignoring
// non-text part types (functionCall / functionResponse / inlineData) for
// the trace-viewer string rendering.
func joinGeminiPartsText(parts gjson.Result) string {
	if !parts.Exists() || !parts.IsArray() {
		return ""
	}
	var out strings.Builder
	parts.ForEach(func(_, p gjson.Result) bool {
		if t := p.Get("text"); t.Exists() {
			if out.Len() > 0 {
				out.WriteByte('\n')
			}
			out.WriteString(t.String())
		}
		return true
	})
	return out.String()
}

// extractOutputMessages returns the JSON-encoded assistant message(s)
// from the response body. The body may be either a single JSON object
// (sync /v1/messages /v1/chat/completions /v1/responses /v1beta..:generateContent
// response) or the concatenated SSE chunks from the streaming variant
// (the trace stream wrapper accumulates every chunk into one buffer
// then hands it here). For streamed bodies the JSON-first parse falls
// through and the SSE walker reassembles the assistant text out of the
// provider-native delta event shape.
func extractOutputMessages(body []byte, reqType domain.RequestType) string {
	if len(body) == 0 {
		return ""
	}
	// The streamed-body extractors below walk the response via
	// walkStreamEvents, which handles both wire framings the trace
	// accumulator can hold: SSE `data: …` lines (raw-framed providers
	// like Anthropic messages and Gemini passthrough) AND bare
	// concatenated JSON objects (OpenAI Responses + Chat, whose Bifrost
	// adapter decodes the upstream stream and re-emits objects the
	// gateway only re-frames with `data:` at the client edge). Try the
	// stream extractor first for every type, then fall back to the
	// single-object JSON shape for non-streamed (sync) responses.
	switch reqType {
	case domain.RequestTypeChat:
		if out := openAIChatOutputFromSSE(body); out != "" {
			return out
		}
		return openAIChatOutputFromJSON(body)
	case domain.RequestTypeMessages:
		if out := anthropicOutputFromSSE(body); out != "" {
			return out
		}
		return anthropicOutputFromJSON(body)
	case domain.RequestTypeResponses:
		if out := responsesOutputFromSSE(body); out != "" {
			return out
		}
		return responsesOutputFromJSON(body)
	case domain.RequestTypePassthrough:
		if out := geminiOutputFromSSE(body); out != "" {
			return out
		}
		return geminiOutputFromJSON(body)
	default:
		return ""
	}
}

// looksLikeSSE returns true if the body's leading non-whitespace bytes
// match SSE framing rather than a JSON object. Both the streaming and
// non-streaming paths land in extractOutputMessages with the same byte
// slice; the dispatch has to detect which shape it is. SSE always opens
// with one of `event:`, `data:`, or `:` (comment); JSON always opens
// with `{` or `[`. Using a leading-prefix test (not a substring scan)
// keeps the check cheap on multi-MB streamed buffers.
func looksLikeSSE(body []byte) bool {
	for i, b := range body {
		switch b {
		case ' ', '\t', '\r', '\n':
			continue
		case '{', '[':
			return false
		default:
			rest := body[i:]
			return strings.HasPrefix(string(rest), "event:") ||
				strings.HasPrefix(string(rest), "data:") ||
				strings.HasPrefix(string(rest), ":")
		}
	}
	return false
}

func openAIChatOutputFromJSON(body []byte) string {
	choices := gjson.GetBytes(body, "choices")
	if !choices.Exists() || !choices.IsArray() {
		return ""
	}
	var msgs []string
	choices.ForEach(func(_, v gjson.Result) bool {
		msg := v.Get("message")
		if msg.Exists() {
			msgs = append(msgs, msg.Raw)
		}
		return true
	})
	if len(msgs) == 0 {
		return ""
	}
	return "[" + strings.Join(msgs, ",") + "]"
}

// openAIChatOutputFromSSE walks OpenAI's chat-completion SSE deltas
// (data: {"choices":[{"delta":{"content":"…"}}]}) and concatenates the
// content fragments. Tool-call deltas are ignored for the human-readable
// trace cell; we only need the assistant text.
func openAIChatOutputFromSSE(body []byte) string {
	var text strings.Builder
	walkStreamEvents(body, func(data []byte) {
		delta := gjson.GetBytes(data, "choices.0.delta.content")
		if delta.Exists() && delta.Type == gjson.String {
			text.WriteString(delta.String())
		}
	})
	if text.Len() == 0 {
		return ""
	}
	return fmt.Sprintf(`[{"role":"assistant","content":%q}]`, text.String())
}

func anthropicOutputFromJSON(body []byte) string {
	content := gjson.GetBytes(body, "content")
	if !content.Exists() || !content.IsArray() {
		return ""
	}
	return `[{"role":"assistant","content":` + content.Raw + `}]`
}

// anthropicOutputFromSSE walks Anthropic's streaming wire (event: …
// data: …\n\n) reassembling the assistant text. The shape is a flat
// stream of content_block_start / content_block_delta(text_delta) /
// content_block_stop / message_delta events; we only need the
// text_delta payloads concatenated in order to recover what the
// assistant said.
func anthropicOutputFromSSE(body []byte) string {
	var text strings.Builder
	walkStreamEvents(body, func(data []byte) {
		eventType := gjson.GetBytes(data, "type").String()
		if eventType != "content_block_delta" {
			return
		}
		deltaType := gjson.GetBytes(data, "delta.type").String()
		if deltaType != "text_delta" {
			return
		}
		if t := gjson.GetBytes(data, "delta.text"); t.Exists() {
			text.WriteString(t.String())
		}
	})
	if text.Len() == 0 {
		return ""
	}
	return fmt.Sprintf(`[{"role":"assistant","content":[{"type":"text","text":%q}]}]`, text.String())
}

func responsesOutputFromJSON(body []byte) string {
	// OpenAI Responses API sync: `output` is an array of items, each a
	// message whose `content` is an array of parts with `text` fields.
	output := gjson.GetBytes(body, "output")
	if !output.Exists() || !output.IsArray() {
		return ""
	}
	var text strings.Builder
	output.ForEach(func(_, item gjson.Result) bool {
		if item.Get("type").String() != "message" {
			return true
		}
		parts := item.Get("content")
		if !parts.Exists() || !parts.IsArray() {
			return true
		}
		parts.ForEach(func(_, p gjson.Result) bool {
			if t := p.Get("text"); t.Exists() {
				if text.Len() > 0 {
					text.WriteByte('\n')
				}
				text.WriteString(t.String())
			}
			return true
		})
		return true
	})
	if text.Len() == 0 {
		return ""
	}
	return fmt.Sprintf(`[{"role":"assistant","content":%q}]`, text.String())
}

// responsesOutputFromSSE walks Responses-API SSE
// (response.output_text.delta events carry .delta string fragments;
// response.completed carries the final .response.output array). Prefer
// the completed snapshot if present, otherwise concatenate deltas.
func responsesOutputFromSSE(body []byte) string {
	var completedSnapshot string
	var deltas strings.Builder
	walkStreamEvents(body, func(data []byte) {
		t := gjson.GetBytes(data, "type").String()
		switch t {
		case "response.completed":
			if r := gjson.GetBytes(data, "response.output"); r.Exists() {
				// Wrap in the same shape as sync responsesOutputFromJSON
				// by re-running the JSON helper against a synthetic body.
				synth := []byte(`{"output":` + r.Raw + `}`)
				if out := responsesOutputFromJSON(synth); out != "" {
					completedSnapshot = out
				}
			}
		case "response.output_text.delta":
			if d := gjson.GetBytes(data, "delta"); d.Exists() && d.Type == gjson.String {
				deltas.WriteString(d.String())
			}
		}
	})
	if completedSnapshot != "" {
		return completedSnapshot
	}
	if deltas.Len() == 0 {
		return ""
	}
	return fmt.Sprintf(`[{"role":"assistant","content":%q}]`, deltas.String())
}

func geminiOutputFromJSON(body []byte) string {
	text := joinGeminiPartsText(gjson.GetBytes(body, "candidates.0.content.parts"))
	if text == "" {
		return ""
	}
	return fmt.Sprintf(`[{"role":"assistant","content":%q}]`, text)
}

// geminiOutputFromSSE concatenates candidates[0].content.parts[*].text
// across every SSE data event. Each chunk carries a delta block whose
// parts array holds the new tokens for that step; the full assistant
// turn is the in-order concatenation across all chunks.
func geminiOutputFromSSE(body []byte) string {
	var text strings.Builder
	walkStreamEvents(body, func(data []byte) {
		parts := gjson.GetBytes(data, "candidates.0.content.parts")
		if !parts.Exists() || !parts.IsArray() {
			return
		}
		parts.ForEach(func(_, p gjson.Result) bool {
			if t := p.Get("text"); t.Exists() {
				text.WriteString(t.String())
			}
			return true
		})
	})
	if text.Len() == 0 {
		return ""
	}
	return fmt.Sprintf(`[{"role":"assistant","content":%q}]`, text.String())
}

// walkStreamEvents yields each per-event JSON payload from a streamed
// response body regardless of how the trace accumulator captured it.
//
// The accumulator (traceStreamWrapper) stores the pre-client-framing
// chunks, and those arrive in two shapes depending on the provider's
// Bifrost adapter:
//   - SSE-framed `data: {…}\n\n` lines — raw-framed providers (Anthropic
//     messages, Gemini passthrough) whose chunks already carry the wire
//     framing, forwarded verbatim to the client.
//   - bare concatenated `{…}{…}` JSON objects — OpenAI Responses + Chat,
//     whose adapter decodes the upstream stream and re-emits objects; the
//     gateway only wraps them in `data:` at the client edge (writeSSE), so
//     the captured body has no framing at all.
//
// Dispatching on looksLikeSSE lets every per-event extractor consume both
// shapes uniformly. Without this, a bare-object responses body fails the
// SSE check, is handed to the single-object JSON extractor, which reads
// only the first object (`response.created`, no `output`) and returns "".
func walkStreamEvents(body []byte, fn func(data []byte)) {
	if looksLikeSSE(body) {
		walkSSEData(body, fn)
		return
	}
	walkConcatenatedJSON(body, fn)
}

// walkConcatenatedJSON invokes fn with each top-level JSON value in a
// buffer of adjacent (un-separated) objects, e.g. the bare event stream
// `{"type":"response.created"}{"type":"response.output_text.delta"}…`.
// json.Decoder reads successive values from one reader, so a stream of
// concatenated objects decodes one at a time. A decode error (EOF, or a
// final object truncated at the 8 MiB body cap) ends the walk best-effort
// with whatever was parsed so far.
func walkConcatenatedJSON(body []byte, fn func(obj []byte)) {
	dec := json.NewDecoder(bytes.NewReader(body))
	for {
		var raw json.RawMessage
		if err := dec.Decode(&raw); err != nil {
			return
		}
		if len(raw) > 0 {
			fn(raw)
		}
	}
}

// walkSSEData iterates every `data: …` line in the body, invoking fn
// with the raw JSON bytes that follow `data: `. Lines starting with
// `event:` / blank lines / `data: [DONE]` are skipped. Multi-line data
// blocks (rare in LLM SSE) are joined with newlines per the SSE spec.
func walkSSEData(body []byte, fn func(data []byte)) {
	var buf strings.Builder
	flush := func() {
		if buf.Len() == 0 {
			return
		}
		payload := strings.TrimSpace(buf.String())
		buf.Reset()
		if payload == "" || payload == "[DONE]" {
			return
		}
		fn([]byte(payload))
	}
	for _, line := range strings.Split(string(body), "\n") {
		if line == "" || line == "\r" {
			flush()
			continue
		}
		if strings.HasPrefix(line, "data:") {
			rest := strings.TrimPrefix(line, "data:")
			rest = strings.TrimPrefix(rest, " ")
			if buf.Len() > 0 {
				buf.WriteByte('\n')
			}
			buf.WriteString(strings.TrimRight(rest, "\r"))
			continue
		}
		// Any non-data line (event: / id: / retry: / comment) flushes
		// the pending block so the next data line starts fresh.
		flush()
	}
	flush()
}
