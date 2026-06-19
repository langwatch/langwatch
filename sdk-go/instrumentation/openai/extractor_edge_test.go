package openai

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"

	"github.com/openai/openai-go/v3"
	"github.com/openai/openai-go/v3/option"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	semconv "go.opentelemetry.io/otel/semconv/v1.40.0"

	langwatch "github.com/langwatch/langwatch/sdk-go"
)

// recordExtractor runs fn against a fresh span and returns the recorded attrs.
func recordExtractor(t *testing.T, fn func(*langwatch.Span)) map[attribute.Key]attribute.Value {
	t.Helper()
	span, exp := newCaptureTestSpan(t)
	fn(span)
	span.End()
	spans := exp.GetSpans()
	require.Len(t, spans, 1)
	attrs := make(map[attribute.Key]attribute.Value, len(spans[0].Attributes))
	for _, kv := range spans[0].Attributes {
		attrs[kv.Key] = kv.Value
	}
	return attrs
}

func TestNoopStreamAccumulator(t *testing.T) {
	t.Run("it does nothing and is never terminal", func(t *testing.T) {
		acc := noopStreamAccumulator{}
		acc.consume("anything")
		assert.False(t, acc.isTerminal("[DONE]"))
		span, exp := newCaptureTestSpan(t)
		acc.finish(span, langwatch.DataCaptureAll)
		span.End()
		assert.Len(t, exp.GetSpans(), 1)
	})
}

func TestToChatMessagesFallback(t *testing.T) {
	t.Run("a non-message payload does not convert to chat messages", func(t *testing.T) {
		_, ok := toChatMessages("not an array of messages")
		assert.False(t, ok)
	})

	t.Run("an empty array does not convert", func(t *testing.T) {
		_, ok := toChatMessages([]any{})
		assert.False(t, ok)
	})
}

func TestGenericExtractorRichBody(t *testing.T) {
	t.Run("it extracts id, model, usage, finish reasons, status and output", func(t *testing.T) {
		const body = `{"id":"gen-1","object":"unknown.thing","model":"some-model","system_fingerprint":"fp_x","usage":{"prompt_tokens":5,"completion_tokens":7,"total_tokens":12},"choices":[{"finish_reason":"stop"}],"status":"completed"}`

		attrs := recordExtractor(t, func(span *langwatch.Span) {
			genericExtractor{}.extractNonStreaming(span, []byte(body), langwatch.DataCaptureAll)
		})

		assert.Equal(t, "gen-1", attrs[semconv.GenAIResponseIDKey].AsString())
		assert.Equal(t, "some-model", attrs[semconv.GenAIResponseModelKey].AsString())
		assert.Equal(t, "fp_x", attrs[semconv.OpenAIResponseSystemFingerprintKey].AsString())
		assert.Equal(t, int64(5), attrs[semconv.GenAIUsageInputTokensKey].AsInt64())
		assert.Equal(t, int64(7), attrs[semconv.GenAIUsageOutputTokensKey].AsInt64())
		assert.Equal(t, []string{"stop"}, attrs[semconv.GenAIResponseFinishReasonsKey].AsStringSlice())
		assert.Equal(t, "completed", attrs[attribute.Key("gen_ai.response.status")].AsString())
		_, hasOutput := attrs[langwatch.AttributeLangWatchOutput]
		assert.True(t, hasOutput)
	})

	t.Run("with capture off it records usage but no output", func(t *testing.T) {
		const body = `{"object":"list","model":"m","usage":{"prompt_tokens":1,"total_tokens":1}}`
		attrs := recordExtractor(t, func(span *langwatch.Span) {
			genericExtractor{}.extractNonStreaming(span, []byte(body), langwatch.DataCaptureNone)
		})
		assert.Equal(t, int64(1), attrs[semconv.GenAIUsageInputTokensKey].AsInt64())
		_, hasOutput := attrs[langwatch.AttributeLangWatchOutput]
		assert.False(t, hasOutput)
	})
}

func TestResponsesStreamErrorEvent(t *testing.T) {
	t.Run("an error event sets the span error status and type", func(t *testing.T) {
		acc := &responsesStreamAccumulator{}
		acc.consume(`{"type":"error","code":"rate_limit_exceeded","message":"slow down"}`)

		span, exp := newCaptureTestSpan(t)
		acc.finish(span, langwatch.DataCaptureAll)
		span.End()

		spans := exp.GetSpans()
		require.Len(t, spans, 1)
		assert.Equal(t, codes.Error, spans[0].Status.Code)
		assert.Equal(t, "slow down", spans[0].Status.Description)

		var errType string
		for _, kv := range spans[0].Attributes {
			if kv.Key == attribute.Key("error.type") {
				errType = kv.Value.AsString()
			}
		}
		assert.Equal(t, "rate_limit_exceeded", errType)
	})
}

func TestMiddlewareEmbeddingsArrayInput(t *testing.T) {
	t.Run("an array input is recorded as json with usage", func(t *testing.T) {
		const respBody = `{"object":"list","data":[{"object":"embedding","index":0,"embedding":[0.1,0.2]}],"model":"text-embedding-3-small","usage":{"prompt_tokens":3,"total_tokens":3}}`
		provider, exporter := newTestProvider(t)
		rt := &mockRoundTripper{statusCode: http.StatusOK, respBody: respBody}
		client := openai.NewClient(
			option.WithAPIKey("k"),
			option.WithHTTPClient(newMockClient(rt)),
			option.WithMiddleware(Middleware("test", WithTracerProvider(provider))),
		)

		_, err := client.Embeddings.New(context.Background(), openai.EmbeddingNewParams{
			Model: openai.EmbeddingModelTextEmbedding3Small,
			Input: openai.EmbeddingNewParamsInputUnion{OfArrayOfStrings: []string{"alpha", "beta"}},
		})
		require.NoError(t, err)

		span := requireSingleSpan(t, provider, exporter)
		attrs := spanAttrs(span)
		assert.Equal(t, "text-embedding-3-small", attrs[semconv.GenAIRequestModelKey].AsString())
		assert.Equal(t, int64(3), attrs[semconv.GenAIUsageInputTokensKey].AsInt64())

		raw, ok := attrs[langwatch.AttributeLangWatchInput]
		require.True(t, ok)
		var env struct {
			Type  string          `json:"type"`
			Value json.RawMessage `json:"value"`
		}
		require.NoError(t, json.Unmarshal([]byte(raw.AsString()), &env))
		assert.Equal(t, "json", env.Type)
		assert.JSONEq(t, `["alpha","beta"]`, string(env.Value))
	})
}
