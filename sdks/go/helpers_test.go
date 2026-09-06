package langwatch

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/attribute"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
)

// recordSpanStub starts a LangWatch span backed by an in-memory exporter, runs
// fn against it, ends it, and returns the exported stub (attributes + events).
// It is the single primitive every other span helper is derived from.
func recordSpanStub(t *testing.T, fn func(s *Span)) tracetest.SpanStub {
	t.Helper()

	exporter := tracetest.NewInMemoryExporter()
	provider := sdktrace.NewTracerProvider(
		sdktrace.WithSpanProcessor(sdktrace.NewSimpleSpanProcessor(exporter)),
	)

	_, span := TracerFromProvider(provider, "test").Start(context.Background(), "op")
	fn(span)
	span.End() // SimpleSpanProcessor exports synchronously on End.

	// Read before any Shutdown: InMemoryExporter.Shutdown resets its buffer.
	spans := exporter.GetSpans()
	require.Len(t, spans, 1)
	return spans[0]
}

// recordSpan is recordSpanStub reduced to the recorded attributes, keyed by key.
func recordSpan(t *testing.T, fn func(s *Span)) map[attribute.Key]attribute.Value {
	t.Helper()

	stub := recordSpanStub(t, fn)
	attrs := make(map[attribute.Key]attribute.Value, len(stub.Attributes))
	for _, kv := range stub.Attributes {
		attrs[kv.Key] = kv.Value
	}
	return attrs
}

// parseEnvelope decodes a {"type":...,"value":...} input/output envelope.
func parseEnvelope(t *testing.T, raw string) (string, json.RawMessage) {
	t.Helper()
	var env struct {
		Type  string          `json:"type"`
		Value json.RawMessage `json:"value"`
	}
	require.NoError(t, json.Unmarshal([]byte(raw), &env))
	return env.Type, env.Value
}
