package openai

import (
	"context"
	"errors"
	"net/http"
	"testing"

	"github.com/openai/openai-go/v3"
	"github.com/openai/openai-go/v3/option"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/codes"
	semconv "go.opentelemetry.io/otel/semconv/v1.40.0"

	langwatch "github.com/langwatch/langwatch/sdk-go"
)

// erroringRoundTripper always fails the request.
type erroringRoundTripper struct{ err error }

func (e erroringRoundTripper) RoundTrip(*http.Request) (*http.Response, error) {
	return nil, e.err
}

func TestMiddleware_TransportError(t *testing.T) {
	t.Run("a transport error marks the span and records the exception", func(t *testing.T) {
		provider, exporter := newTestProvider(t)
		client := openai.NewClient(
			option.WithAPIKey("k"),
			option.WithHTTPClient(&http.Client{Transport: erroringRoundTripper{err: errors.New("boom")}}),
			option.WithMaxRetries(0),
			option.WithMiddleware(Middleware("test", WithTracerProvider(provider))),
		)

		_, err := client.Chat.Completions.New(context.Background(), benchParams())
		require.Error(t, err)

		span := requireSingleSpan(t, provider, exporter)
		assert.Equal(t, codes.Error, span.Status().Code)
		assert.NotEmpty(t, span.Events(), "the error is recorded as a span event")
	})
}

func TestMiddleware_HTTPErrorStatus(t *testing.T) {
	t.Run("a 4xx response sets an error status and records no output", func(t *testing.T) {
		provider, exporter := newTestProvider(t)
		rt := &mockRoundTripper{statusCode: http.StatusTooManyRequests, respBody: `{"error":{"message":"rate limited"}}`}
		client := openai.NewClient(
			option.WithAPIKey("k"),
			option.WithHTTPClient(newMockClient(rt)),
			option.WithMaxRetries(0),
			option.WithMiddleware(Middleware("test", WithTracerProvider(provider))),
		)

		_, err := client.Chat.Completions.New(context.Background(), benchParams())
		require.Error(t, err) // a 429 surfaces as an API error

		span := requireSingleSpan(t, provider, exporter)
		assert.Equal(t, codes.Error, span.Status().Code)
		attrs := spanAttrs(span)
		assert.Equal(t, int64(http.StatusTooManyRequests), attrs[semconv.HTTPResponseStatusCodeKey].AsInt64())
		_, hasOutput := attrs[langwatch.AttributeLangWatchOutput]
		assert.False(t, hasOutput, "no output is parsed from an error response")
		_, hasGenAIOutput := attrs[genAIOutputKey]
		assert.False(t, hasGenAIOutput, "no gen_ai output is parsed from an error response")
	})
}

func TestMiddleware_NonJSONResponse(t *testing.T) {
	t.Run("a non-JSON 200 response still records the request but no output", func(t *testing.T) {
		provider, exporter := newTestProvider(t)
		rt := &mockRoundTripper{statusCode: http.StatusOK, respBody: "not json", contentType: "text/plain"}
		client := openai.NewClient(
			option.WithAPIKey("k"),
			option.WithHTTPClient(newMockClient(rt)),
			option.WithMaxRetries(0),
			option.WithMiddleware(Middleware("test", WithTracerProvider(provider))),
		)

		// The client itself errors trying to decode a non-JSON body; we only
		// assert on the span the middleware produced.
		_, _ = client.Chat.Completions.New(context.Background(), benchParams())

		span := requireSingleSpan(t, provider, exporter)
		attrs := spanAttrs(span)
		assert.Equal(t, "gpt-4o-mini", attrs[semconv.GenAIRequestModelKey].AsString(), "request is still recorded")
		_, hasOutput := attrs[langwatch.AttributeLangWatchOutput]
		assert.False(t, hasOutput, "a non-JSON body is not parsed for output")
		_, hasGenAIOutput := attrs[genAIOutputKey]
		assert.False(t, hasGenAIOutput, "a non-JSON body is not parsed for gen_ai output")
	})
}

func TestMiddleware_DataCaptureNone(t *testing.T) {
	t.Run("none mode keeps usage and model but drops input/output content", func(t *testing.T) {
		provider, exporter := newTestProvider(t)
		rt := &mockRoundTripper{statusCode: http.StatusOK, respBody: benchChatResp}
		client := openai.NewClient(
			option.WithAPIKey("k"),
			option.WithHTTPClient(newMockClient(rt)),
			option.WithMiddleware(Middleware("test", WithTracerProvider(provider), WithDataCapture(langwatch.DataCaptureNone))),
		)

		_, err := client.Chat.Completions.New(context.Background(), benchParams())
		require.NoError(t, err)

		span := requireSingleSpan(t, provider, exporter)
		attrs := spanAttrs(span)
		// Structure + usage are always recorded.
		assert.Equal(t, "gpt-4o-mini", attrs[semconv.GenAIRequestModelKey].AsString())
		assert.Equal(t, int64(12), attrs[semconv.GenAIUsageInputTokensKey].AsInt64())
		// Content is gated off at the source. Chat messages live under the
		// gen_ai.* keys, so assert those are absent (along with the legacy
		// langwatch.* keys, which must never carry chat content).
		_, hasGenAIInput := attrs[genAIInputKey]
		_, hasGenAIOutput := attrs[genAIOutputKey]
		assert.False(t, hasGenAIInput, "input content gated off")
		assert.False(t, hasGenAIOutput, "output content gated off")
		_, hasInput := attrs[langwatch.AttributeLangWatchInput]
		_, hasOutput := attrs[langwatch.AttributeLangWatchOutput]
		assert.False(t, hasInput, "no chat content under langwatch.input")
		assert.False(t, hasOutput, "no chat content under langwatch.output")
	})
}
