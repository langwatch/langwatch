package anthropic

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

func newMockClient(rt *mockRoundTripper) *http.Client {
	return &http.Client{Transport: rt}
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

// genAIMessages parses a gen_ai.input.messages / gen_ai.output.messages
// attribute value. These are recorded as a RAW JSON array of ChatMessage (no
// {type,value} typedValue envelope), so they unmarshal directly.
func genAIMessages(t *testing.T, raw string) []langwatch.ChatMessage {
	t.Helper()
	var msgs []langwatch.ChatMessage
	require.NoError(t, json.Unmarshal([]byte(raw), &msgs), "parse gen_ai messages: %s", raw)
	return msgs
}

// spanMetrics is the JSON envelope recorded under langwatch.metrics.
type spanMetrics struct {
	PromptTokens             *int `json:"prompt_tokens"`
	CompletionTokens         *int `json:"completion_tokens"`
	CacheReadInputTokens     *int `json:"cache_read_input_tokens"`
	CacheCreationInputTokens *int `json:"cache_creation_input_tokens"`
}

// parseMetrics parses a langwatch.metrics attribute value.
func parseMetrics(t *testing.T, raw string) spanMetrics {
	t.Helper()
	var m spanMetrics
	require.NoError(t, json.Unmarshal([]byte(raw), &m), "parse metrics: %s", raw)
	return m
}

// requireSingleSpan flushes and returns the single exported span.
func requireSingleSpan(t *testing.T, provider *sdktrace.TracerProvider, exporter *tracetest.InMemoryExporter) sdktrace.ReadOnlySpan {
	t.Helper()
	require.NoError(t, provider.ForceFlush(t.Context()))
	spans := exporter.GetSpans()
	require.Len(t, spans, 1, "expected exactly one exported span")
	return spans[0].Snapshot()
}

// inputKey/outputKey are the LangWatch content attribute keys (arbitrary span
// I/O). LLM chat messages and the system prompt go under the gen_ai.* keys
// instead, NOT these.
var (
	inputKey   = langwatch.AttributeLangWatchInput
	outputKey  = langwatch.AttributeLangWatchOutput
	metricsKey = langwatch.AttributeLangWatchMetrics
)

// gen_ai.* content keys: chat input/output messages (raw JSON arrays) and the
// system prompt (plain string).
var (
	genAIInputKey  = semconv.GenAIInputMessagesKey
	genAIOutputKey = semconv.GenAIOutputMessagesKey
	genAISystemKey = semconv.GenAISystemInstructionsKey
)
