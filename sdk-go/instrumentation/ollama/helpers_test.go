package ollama

import (
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"

	"github.com/ollama/ollama/api"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/attribute"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	semconv "go.opentelemetry.io/otel/semconv/v1.40.0"

	langwatch "github.com/langwatch/langwatch/sdk-go"
)

// mockRoundTripper returns a canned response for any request. It captures the
// request body so tests can assert on what was sent, and chooses the
// Content-Type from the response shape (NDJSON for newline-delimited streams)
// unless one is set explicitly.
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
		// A body with an internal newline between JSON objects is an NDJSON
		// stream; a single object is a plain JSON response.
		if strings.Count(strings.TrimSpace(m.respBody), "\n") > 0 {
			contentType = "application/x-ndjson"
		} else {
			contentType = "application/json"
		}
	}

	header := http.Header{}
	header.Set("Content-Type", contentType)
	return &http.Response{
		StatusCode: m.statusCode,
		Status:     http.StatusText(m.statusCode),
		Body:       io.NopCloser(strings.NewReader(m.respBody)),
		Header:     header,
	}, nil
}

// newTracedClient builds a real Ollama api.Client whose *http.Client transport
// is the ollama tracing transport wrapping the given mock round tripper,
// mirroring the documented NewHTTPClient wiring.
func newTracedClient(t *testing.T, rt *mockRoundTripper, opts ...Option) *api.Client {
	t.Helper()
	base, err := url.Parse("http://localhost:11434")
	require.NoError(t, err)
	httpClient := &http.Client{Transport: NewTransportWithBase(rt, opts...)}
	return api.NewClient(base, httpClient)
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

// chatMessage is the LangWatch chat-message shape recorded under the gen_ai
// message keys (a raw JSON array, no typed-value envelope). Per the LangWatch
// convention, a tool call's Arguments is a JSON-encoded string (not a nested
// object).
type chatMessage struct {
	Role      string `json:"role"`
	Content   any    `json:"content"`
	ToolCalls []struct {
		ID       string `json:"id"`
		Type     string `json:"type"`
		Function struct {
			Name      string `json:"name"`
			Arguments string `json:"arguments"`
		} `json:"function"`
	} `json:"tool_calls"`
}

// genAIMessages parses a gen_ai.input.messages / gen_ai.output.messages attribute
// value. Unlike langwatch.input/output, these are recorded as a raw JSON array of
// chat messages with no {type,value} envelope.
func genAIMessages(t *testing.T, raw string) []chatMessage {
	t.Helper()
	var msgs []chatMessage
	require.NoError(t, json.Unmarshal([]byte(raw), &msgs), "parse gen_ai messages: %s", raw)
	return msgs
}

// spanMetrics is the langwatch.metrics token rollup recorded on the span.
type spanMetrics struct {
	PromptTokens     *int `json:"prompt_tokens"`
	CompletionTokens *int `json:"completion_tokens"`
}

// parseMetrics parses the langwatch.metrics attribute value.
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

// boolPtr returns a pointer to b, for setting Ollama's *bool stream flag.
func boolPtr(b bool) *bool { return &b }

// inputKey/outputKey/metricsKey are the LangWatch content attribute keys.
// genAIInputKey/genAIOutputKey/genAISystemKey are the OTel gen_ai-native keys
// under which LLM request/response messages and system instructions are recorded.
var (
	inputKey       = langwatch.AttributeLangWatchInput
	outputKey      = langwatch.AttributeLangWatchOutput
	metricsKey     = langwatch.AttributeLangWatchMetrics
	genAIInputKey  = semconv.GenAIInputMessagesKey
	genAIOutputKey = semconv.GenAIOutputMessagesKey
	genAISystemKey = semconv.GenAISystemInstructionsKey
)
