package azureopenai_test

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/attribute"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	semconv "go.opentelemetry.io/otel/semconv/v1.40.0"

	azureopenai "github.com/langwatch/langwatch/sdk-go/instrumentation/azureopenai"
	openai "github.com/openai/openai-go/v3"
	"github.com/openai/openai-go/v3/azure"
	"github.com/openai/openai-go/v3/option"
)

const (
	azureEndpoint   = "https://example-resource.openai.azure.com"
	azureAPIVersion = "2024-06-01"
)

// mockRoundTripper returns a canned response for any request, capturing the
// request path so tests can confirm the Azure deployment rewrite reached the
// transport. Mirrors instrumentation/openai/helpers_test.go.
type mockRoundTripper struct {
	statusCode  int
	respBody    string
	contentType string
	capturedReq []byte
	capturedURL string
}

func (m *mockRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	m.capturedURL = req.URL.Path
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

// requireSingleSpan flushes and returns the single exported span.
func requireSingleSpan(t *testing.T, provider *sdktrace.TracerProvider, exporter *tracetest.InMemoryExporter) sdktrace.ReadOnlySpan {
	t.Helper()
	require.NoError(t, provider.ForceFlush(t.Context()))
	spans := exporter.GetSpans()
	require.Len(t, spans, 1, "expected exactly one exported span")
	return spans[0].Snapshot()
}

// newAzureClient builds a real openai.Client configured for Azure (deployment
// path rewrite + api-version), with the mock transport and the azureopenai
// middleware wired in.
func newAzureClient(rt *mockRoundTripper, mw option.Middleware) openai.Client {
	return openai.NewClient(
		azure.WithEndpoint(azureEndpoint, azureAPIVersion),
		azure.WithAPIKey("dummy-azure-key"),
		option.WithHTTPClient(newMockClient(rt)),
		option.WithMiddleware(mw),
	)
}

// TestMiddleware_AzureProviderDefault proves the delegation: a real Azure-
// configured client gets a span with the model and token usage from the OpenAI
// instrumentation, and the provider defaulted to "azure.openai".
func TestMiddleware_AzureProviderDefault(t *testing.T) {
	const respBody = `{"id":"chatcmpl-az","object":"chat.completion","created":1700000000,"model":"gpt-4o-2024-08-06","choices":[{"index":0,"message":{"role":"assistant","content":"pong"},"finish_reason":"stop"}],"usage":{"prompt_tokens":9,"completion_tokens":4,"total_tokens":13,"prompt_tokens_details":{"cached_tokens":2}}}`

	rt := &mockRoundTripper{statusCode: http.StatusOK, respBody: respBody}
	provider, exporter := newTestProvider(t)
	client := newAzureClient(rt, azureopenai.Middleware("azure-app", azureopenai.WithTracerProvider(provider)))

	_, err := client.Chat.Completions.New(context.Background(), openai.ChatCompletionNewParams{
		Model:    "my-gpt4o-deployment",
		Messages: []openai.ChatCompletionMessageParamUnion{openai.UserMessage("ping")},
	})
	require.NoError(t, err)

	span := requireSingleSpan(t, provider, exporter)
	attrs := spanAttrs(span)

	// The default this module adds — recorded as gen_ai.provider.name.
	assert.Equal(t, attribute.StringValue("azure.openai"), attrs[semconv.GenAIProviderNameKey])

	// The Azure deployment-path rewrite reached the transport, and the OpenAI
	// instrumentation still derived the chat operation from that path.
	assert.Equal(t, "/openai/deployments/my-gpt4o-deployment/chat/completions", rt.capturedURL)
	assert.Equal(t, attribute.StringValue("chat"), attrs[semconv.GenAIOperationNameKey])

	// Usual OpenAI capture applies unchanged.
	assert.Equal(t, attribute.StringValue("my-gpt4o-deployment"), attrs[semconv.GenAIRequestModelKey])
	assert.Equal(t, attribute.StringValue("gpt-4o-2024-08-06"), attrs[semconv.GenAIResponseModelKey])
	assert.Equal(t, attribute.StringValue("chatcmpl-az"), attrs[semconv.GenAIResponseIDKey])
	assert.Equal(t, attribute.IntValue(9), attrs[semconv.GenAIUsageInputTokensKey])
	assert.Equal(t, attribute.IntValue(4), attrs[semconv.GenAIUsageOutputTokensKey])
	assert.Equal(t, attribute.IntValue(2), attrs[attribute.Key("gen_ai.usage.cached_input_tokens")])
}

// TestMiddleware_ExplicitProviderOverridesDefault verifies a caller-supplied
// WithGenAIProvider wins over the "azure.openai" default this module prepends.
func TestMiddleware_ExplicitProviderOverridesDefault(t *testing.T) {
	const respBody = `{"id":"chatcmpl-ov","object":"chat.completion","model":"gpt-4o","choices":[{"index":0,"message":{"role":"assistant","content":"pong"},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":1,"total_tokens":3}}`

	rt := &mockRoundTripper{statusCode: http.StatusOK, respBody: respBody}
	provider, exporter := newTestProvider(t)
	client := newAzureClient(rt, azureopenai.Middleware("azure-app",
		azureopenai.WithTracerProvider(provider),
		// Explicit override applied after the prepended default.
		azureopenai.WithGenAIProvider(semconv.GenAIProviderNameKey.String("custom.provider")),
	))

	_, err := client.Chat.Completions.New(context.Background(), openai.ChatCompletionNewParams{
		Model:    "my-deployment",
		Messages: []openai.ChatCompletionMessageParamUnion{openai.UserMessage("ping")},
	})
	require.NoError(t, err)

	span := requireSingleSpan(t, provider, exporter)
	attrs := spanAttrs(span)

	// The explicit override wins over the module default.
	assert.Equal(t, attribute.StringValue("custom.provider"), attrs[semconv.GenAIProviderNameKey])
}
