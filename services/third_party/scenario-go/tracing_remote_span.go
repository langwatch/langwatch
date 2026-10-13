package scenario

import (
	"encoding/hex"
	"encoding/json"
	"math"
	"time"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/sdk/instrumentation"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.opentelemetry.io/otel/trace"

	"github.com/langwatch/scenario/go/internal/jsjson"
)

// langWatchAPISpan is a span as the LangWatch trace API returns it
// (GET /api/trace/{traceId}). Every field but the ids is optional, so a
// partially populated span still converts. Timestamps are epoch
// milliseconds. Payloads stay raw so they are re-encoded once, in source
// key order.
type langWatchAPISpan struct {
	SpanID     string             `json:"span_id"`
	TraceID    string             `json:"trace_id"`
	ParentID   string             `json:"parent_id"`
	Type       string             `json:"type"`
	Name       string             `json:"name"`
	Input      *langWatchAPIIO    `json:"input"`
	Output     *langWatchAPIIO    `json:"output"`
	Error      *langWatchAPIError `json:"error"`
	Timestamps *struct {
		StartedAt  float64 `json:"started_at"`
		FinishedAt float64 `json:"finished_at"`
	} `json:"timestamps"`
	Metrics *struct {
		PromptTokens     *float64 `json:"prompt_tokens"`
		CompletionTokens *float64 `json:"completion_tokens"`
		Cost             *float64 `json:"cost"`
	} `json:"metrics"`
	Params   json.RawMessage `json:"params"`
	Model    string          `json:"model"`
	Vendor   string          `json:"vendor"`
	Contexts json.RawMessage `json:"contexts"`
}

type langWatchAPIIO struct {
	Type  string          `json:"type"`
	Value json.RawMessage `json:"value"`
}

type langWatchAPIError struct {
	Message string `json:"message"`
}

func isJSONNull(raw json.RawMessage) bool {
	return len(raw) == 0 || string(raw) == "null"
}

// ioAttribute renders an input/output payload as an attribute string: a
// string value stays raw, anything else is JSON-encoded, the form both the
// JS and the Python SDK write.
func ioAttribute(io *langWatchAPIIO) (string, bool) {
	if io == nil || isJSONNull(io.Value) {
		return "", false
	}
	if io.Value[0] == '"' {
		var s string
		if err := json.Unmarshal(io.Value, &s); err == nil {
			return s, true
		}
	}
	return jsjson.Compact(string(io.Value)), true
}

// attrBuilder collects attributes in insertion order; a repeated key keeps
// its first position and takes the last value, like a JS object.
type attrBuilder struct {
	kvs   []attribute.KeyValue
	index map[attribute.Key]int
}

func (a *attrBuilder) set(kv attribute.KeyValue) {
	if a.index == nil {
		a.index = make(map[attribute.Key]int, 16)
	}
	if i, ok := a.index[kv.Key]; ok {
		a.kvs[i] = kv
		return
	}
	a.index[kv.Key] = len(a.kvs)
	a.kvs = append(a.kvs, kv)
}

// scalarAttribute converts a parsed JSON scalar to an attribute value.
func scalarAttribute(key string, v any) (attribute.KeyValue, bool) {
	switch x := v.(type) {
	case string:
		return attribute.String(key, x), true
	case float64:
		return attribute.Float64(key, x), true
	case bool:
		return attribute.Bool(key, x), true
	}
	return attribute.KeyValue{}, false
}

// flattenParams flattens nested params into dot-notation attributes: scalars
// directly, lists as JSON, objects recursed into; nulls and the _keys
// indexing artifact are skipped.
func flattenParams(a *attrBuilder, params jsjson.Object, prefix string) {
	for _, m := range params {
		if m.Key == "_keys" || m.Value == nil {
			continue
		}
		key := m.Key
		if prefix != "" {
			key = prefix + "." + m.Key
		}
		switch v := m.Value.(type) {
		case []any:
			a.set(attribute.String(key, jsjson.Stringify(v)))
		case jsjson.Object:
			flattenParams(a, v, key)
		default:
			if kv, ok := scalarAttribute(key, v); ok {
				a.set(kv)
			}
		}
	}
}

func (s *langWatchAPISpan) attributes(threadID string) []attribute.KeyValue {
	a := attrBuilder{kvs: make([]attribute.KeyValue, 0, 12)}
	spanType := s.Type
	if spanType == "" {
		spanType = "span"
	}
	a.set(attribute.String("langwatch.span.type", spanType))
	if v, ok := ioAttribute(s.Input); ok {
		a.set(attribute.String("langwatch.input", v))
		if s.Input.Type == "chat_messages" {
			a.set(attribute.String("gen_ai.input.messages", v))
		}
	}
	if v, ok := ioAttribute(s.Output); ok {
		a.set(attribute.String("langwatch.output", v))
		if s.Output.Type == "chat_messages" {
			a.set(attribute.String("gen_ai.output.messages", v))
		}
	}
	if s.Model != "" {
		a.set(attribute.String("gen_ai.request.model", s.Model))
	}
	if s.Vendor != "" {
		a.set(attribute.String("gen_ai.system", s.Vendor))
	}
	if !isJSONNull(s.Params) {
		if parsed, err := jsjson.Parse(string(s.Params)); err == nil {
			if params, ok := parsed.(jsjson.Object); ok {
				for _, p := range [...]struct{ from, to string }{
					{"temperature", "gen_ai.request.temperature"},
					{"max_tokens", "gen_ai.request.max_tokens"},
					{"top_p", "gen_ai.request.top_p"},
				} {
					if v, ok := params.Get(p.from); ok && v != nil {
						if kv, ok := scalarAttribute(p.to, v); ok {
							a.set(kv)
						}
					}
				}
				flattenParams(&a, params, "")
			}
		}
	}
	if m := s.Metrics; m != nil {
		if m.PromptTokens != nil {
			a.set(attribute.Float64("gen_ai.usage.prompt_tokens", *m.PromptTokens))
		}
		if m.CompletionTokens != nil {
			a.set(attribute.Float64("gen_ai.usage.completion_tokens", *m.CompletionTokens))
		}
		if m.Cost != nil {
			a.set(attribute.Float64("gen_ai.usage.cost", *m.Cost))
		}
	}
	if !isJSONNull(s.Contexts) {
		a.set(attribute.String("retrieval.documents", jsjson.Compact(string(s.Contexts))))
	}
	if threadID != "" {
		a.set(attribute.String(threadIDKey, threadID))
	}
	return a.kvs
}

func spanKindOf(spanType string) trace.SpanKind {
	switch spanType {
	case "server":
		return trace.SpanKindServer
	case "client":
		return trace.SpanKindClient
	case "producer":
		return trace.SpanKindProducer
	case "consumer":
		return trace.SpanKindConsumer
	}
	return trace.SpanKindInternal
}

// epochMillis converts epoch milliseconds, possibly fractional, to a time.
func epochMillis(ms float64) time.Time {
	whole := math.Trunc(ms)
	return time.UnixMilli(int64(whole)).Add(time.Duration(math.Round((ms - whole) * 1e6)))
}

// parseSpanID decodes a 16 hex digit span id.
func parseSpanID(s string) (trace.SpanID, bool) {
	var id trace.SpanID
	if len(s) != 2*len(id) {
		return id, false
	}
	_, err := hex.Decode(id[:], []byte(s))
	return id, err == nil
}

// parseTraceID decodes a 32 hex digit trace id.
func parseTraceID(s string) (trace.TraceID, bool) {
	var id trace.TraceID
	if len(s) != 2*len(id) {
		return id, false
	}
	_, err := hex.Decode(id[:], []byte(s))
	return id, err == nil
}

// readOnlySpan converts the API span into an ended span the digest and the
// trace tools read, tagged with threadID. Span type, payloads, params and
// metrics become langwatch.* and gen_ai.* attributes.
func (s *langWatchAPISpan) readOnlySpan(traceID trace.TraceID, spanID trace.SpanID, threadID string) sdktrace.ReadOnlySpan {
	var start, end time.Time
	if s.Timestamps != nil {
		start, end = epochMillis(s.Timestamps.StartedAt), epochMillis(s.Timestamps.FinishedAt)
	} else {
		start, end = time.UnixMilli(0), time.UnixMilli(0)
	}
	stub := tracetest.SpanStub{
		Name: s.Name,
		SpanContext: trace.NewSpanContext(trace.SpanContextConfig{
			TraceID: traceID, SpanID: spanID, TraceFlags: trace.FlagsSampled,
		}),
		SpanKind:             spanKindOf(s.Type),
		StartTime:            start,
		EndTime:              end,
		Status:               sdktrace.Status{Code: codes.Ok},
		Attributes:           s.attributes(threadID),
		InstrumentationScope: instrumentation.Scope{Name: "langwatch"},
	}
	if s.Error != nil {
		stub.Status = sdktrace.Status{Code: codes.Error, Description: s.Error.Message}
	}
	if parent, ok := parseSpanID(s.ParentID); ok {
		stub.Parent = trace.NewSpanContext(trace.SpanContextConfig{
			TraceID: traceID, SpanID: parent, TraceFlags: trace.FlagsSampled,
		})
	}
	return stub.Snapshot()
}
