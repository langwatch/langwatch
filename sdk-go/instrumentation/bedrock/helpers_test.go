package bedrock

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/attribute"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	semconv "go.opentelemetry.io/otel/semconv/v1.40.0"
	"go.opentelemetry.io/otel/trace"

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
		_ = sp.Shutdown(t.Context())
		_ = exporter.Shutdown(t.Context())
	})
	return provider, exporter
}

// spanAttrs flattens a span's attributes into a map keyed by attribute key.
func spanAttrs(span sdktrace.ReadOnlySpan) map[attribute.Key]attribute.Value {
	out := make(map[attribute.Key]attribute.Value, len(span.Attributes()))
	for _, kv := range span.Attributes() {
		out[kv.Key] = kv.Value
	}
	return out
}

// requireSingleSpan flushes and returns the single exported span.
func requireSingleSpan(t *testing.T, provider *sdktrace.TracerProvider, exporter *tracetest.InMemoryExporter) sdktrace.ReadOnlySpan {
	t.Helper()
	require.NoError(t, provider.ForceFlush(t.Context()))
	spans := exporter.GetSpans()
	require.Len(t, spans, 1, "expected exactly one exported span")
	return spans[0].Snapshot()
}

// genAIMessages parses a gen_ai.input.messages / gen_ai.output.messages attribute
// value. These are a RAW JSON array of LangWatch chat messages (no typedValue
// envelope), so the raw attribute string unmarshals directly.
func genAIMessages(t *testing.T, raw string) []langwatch.ChatMessage {
	t.Helper()
	var msgs []langwatch.ChatMessage
	require.NoError(t, json.Unmarshal([]byte(raw), &msgs), "parse gen_ai messages: %s", raw)
	return msgs
}

// inputKey/outputKey are the LangWatch content attribute keys.
var (
	inputKey  = langwatch.AttributeLangWatchInput
	outputKey = langwatch.AttributeLangWatchOutput
)

// genAIInputKey/genAIOutputKey/genAISystemKey are the OpenTelemetry GenAI message
// attribute keys LLM content is recorded under.
var (
	genAIInputKey  = semconv.GenAIInputMessagesKey
	genAIOutputKey = semconv.GenAIOutputMessagesKey
	genAISystemKey = semconv.GenAISystemInstructionsKey
)

// startSpanWithHandler runs a handler's request + response mapping against a
// fresh span, mirroring what the middleware does, and returns the exported span.
// It is the unit-level entry point for the attribute-mapping tests.
func startSpanWithHandler(
	t *testing.T,
	handler operationHandler,
	params any,
	result any,
	capture langwatch.DataCaptureMode,
	provider trace.TracerProvider,
) {
	t.Helper()
	tracer := langwatch.TracerFromProvider(provider, tracerName)
	_, span := tracer.Start(context.Background(), "test",
		trace.WithSpanKind(trace.SpanKindClient),
		trace.WithAttributes(
			defaultGenAIProvider,
			langwatch.AttributeLangWatchSpanType.String(string(langwatch.SpanTypeLLM)),
		),
	)
	handler.recordRequest(span, params, capture)
	ownsSpan := handler.recordResponse(context.Background(), span, result, capture, time.Now())
	if !ownsSpan {
		span.End()
	}
}

// stubCredentials is a static credential provider for round-trip tests so SigV4
// signing succeeds without real AWS credentials.
type stubCredentials struct{}

func (stubCredentials) Retrieve(context.Context) (aws.Credentials, error) {
	return aws.Credentials{AccessKeyID: "AKIATEST", SecretAccessKey: "secret", SessionToken: ""}, nil
}
