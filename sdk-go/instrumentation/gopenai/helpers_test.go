package gopenai

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/attribute"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	semconv "go.opentelemetry.io/otel/semconv/v1.40.0"

	langwatch "github.com/langwatch/langwatch/sdk-go"
	openai "github.com/sashabaranov/go-openai"
)

// mockRoundTripper returns a canned response for any request. It captures the
// request body so tests can assert on what was sent, and chooses the
// Content-Type from the response shape (SSE for streams).
type mockRoundTripper struct {
	statusCode  int
	respBody    string
	contentType string
	capturedReq []byte
}

func (m *mockRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	if req.Body != nil {
		m.capturedReq, _ = io.ReadAll(req.Body)
		req.Body = io.NopCloser(strings.NewReader(string(m.capturedReq)))
	}

	contentType := m.contentType
	if contentType == "" {
		if strings.Contains(m.respBody, "data:") {
			contentType = "text/event-stream"
		} else {
			contentType = "application/json"
		}
	}

	header := http.Header{}
	header.Set("Content-Type", contentType)
	return &http.Response{
		StatusCode: m.statusCode,
		Body:       io.NopCloser(strings.NewReader(m.respBody)),
		Header:     header,
	}, nil
}

// newTracedClient builds a real go-openai client whose HTTP transport is the
// gopenai tracing transport wrapping the given mock round tripper, mirroring the
// documented WrapConfig wiring.
func newTracedClient(rt *mockRoundTripper, opts ...Option) *openai.Client {
	config := openai.DefaultConfig("dummy-key")
	config.HTTPClient = &http.Client{Transport: rt}
	WrapConfig(&config, opts...)
	return openai.NewClientWithConfig(config)
}

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
// value. Unlike langwatch.input/output, the gen_ai keys carry a raw JSON array of
// chat messages directly, with no {type,value} envelope.
func genAIMessages(t *testing.T, raw string) []langwatch.ChatMessage {
	t.Helper()
	var msgs []langwatch.ChatMessage
	require.NoError(t, json.Unmarshal([]byte(raw), &msgs), "parse gen_ai messages: %s", raw)
	return msgs
}

// requireSingleSpan flushes and returns the single exported span.
func requireSingleSpan(t *testing.T, provider *sdktrace.TracerProvider, exporter *tracetest.InMemoryExporter) sdktrace.ReadOnlySpan {
	t.Helper()
	require.NoError(t, provider.ForceFlush(t.Context()))
	spans := exporter.GetSpans()
	require.Len(t, spans, 1, "expected exactly one exported span")
	return spans[0].Snapshot()
}

// inputKey/outputKey are the LangWatch content attribute keys.
// genAIInputKey/genAIOutputKey/genAISystemKey are the OpenTelemetry GenAI-native
// message keys, which carry raw JSON arrays (no typed-value envelope).
var (
	inputKey       = langwatch.AttributeLangWatchInput
	outputKey      = langwatch.AttributeLangWatchOutput
	genAIInputKey  = semconv.GenAIInputMessagesKey
	genAIOutputKey = semconv.GenAIOutputMessagesKey
	genAISystemKey = semconv.GenAISystemInstructionsKey
)
