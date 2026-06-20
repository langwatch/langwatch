package openaiformat

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/attribute"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	semconv "go.opentelemetry.io/otel/semconv/v1.40.0"

	langwatch "github.com/langwatch/langwatch/sdk-go"
)

// newTestProvider returns an in-memory tracer provider and its exporter, with
// cleanup registered on the test.
func newTestProvider(t *testing.T) (*sdktrace.TracerProvider, *tracetest.InMemoryExporter) {
	t.Helper()
	exporter := tracetest.NewInMemoryExporter()
	sp := sdktrace.NewSimpleSpanProcessor(exporter)
	provider := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(sp))
	t.Cleanup(func() {
		_ = sp.Shutdown(context.Background())
		_ = exporter.Shutdown(context.Background())
	})
	return provider, exporter
}

// newSpan starts a fresh span on an in-memory provider, returning the span and
// the exporter so a test can run an extractor against the span and read back the
// attributes it recorded.
func newSpan(t *testing.T) (*langwatch.Span, *tracetest.InMemoryExporter) {
	t.Helper()
	provider, exporter := newTestProvider(t)
	_, span := langwatch.TracerFromProvider(provider, "test").Start(context.Background(), "op")
	return span, exporter
}

// recordExtractor runs fn against a fresh span and returns the recorded attrs.
func recordExtractor(t *testing.T, fn func(*langwatch.Span)) map[attribute.Key]attribute.Value {
	t.Helper()
	span, exp := newSpan(t)
	fn(span)
	span.End()
	spans := exp.GetSpans()
	require.Len(t, spans, 1)
	return attrsOf(spans[0].Attributes)
}

// attrsOf flattens a span's attributes into a map keyed by attribute key.
func attrsOf(kvs []attribute.KeyValue) map[attribute.Key]attribute.Value {
	out := make(map[attribute.Key]attribute.Value, len(kvs))
	for _, kv := range kvs {
		out[kv.Key] = kv.Value
	}
	return out
}

// typedValue is the JSON envelope recorded under langwatch.input/output.
type typedValue struct {
	Type  string          `json:"type"`
	Value json.RawMessage `json:"value"`
}

// parseTypedValue parses a langwatch.input/output attribute value.
func parseTypedValue(t *testing.T, raw string) typedValue {
	t.Helper()
	var tv typedValue
	require.NoError(t, json.Unmarshal([]byte(raw), &tv), "parse typed value: %s", raw)
	return tv
}

// genAIMessages parses a gen_ai.input.messages / gen_ai.output.messages attribute
// value, which is a raw JSON array of chat messages (no {type,value} envelope).
func genAIMessages(t *testing.T, raw string) []langwatch.ChatMessage {
	t.Helper()
	var msgs []langwatch.ChatMessage
	require.NoError(t, json.Unmarshal([]byte(raw), &msgs), "parse gen_ai messages: %s", raw)
	return msgs
}

// Attribute-key aliases shared across the extractor tests.
var (
	inputKey       = langwatch.AttributeLangWatchInput
	outputKey      = langwatch.AttributeLangWatchOutput
	genAIInputKey  = semconv.GenAIInputMessagesKey
	genAIOutputKey = semconv.GenAIOutputMessagesKey
	genAISystemKey = semconv.GenAISystemInstructionsKey

	semconvGenAIResponseID        = semconv.GenAIResponseIDKey
	semconvGenAIUsageInputTokens  = semconv.GenAIUsageInputTokensKey
	semconvGenAIUsageOutputTokens = semconv.GenAIUsageOutputTokensKey
)
