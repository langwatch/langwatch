package openai

import (
	"context"
	"net/http"
	"testing"

	"github.com/openai/openai-go/v3"
	"github.com/openai/openai-go/v3/option"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/codes"
	semconv "go.opentelemetry.io/otel/semconv/v1.41.0"
)

// envelopeClient answers every call 200 with body, through the traced middleware.
func envelopeClient(t *testing.T, body string) (openai.Client, func() codes.Code, func() (string, map[string]string)) {
	t.Helper()
	provider, exporter := newTestProvider(t)
	rt := &mockRoundTripper{statusCode: http.StatusOK, respBody: body}
	client := openai.NewClient(
		option.WithAPIKey("k"),
		option.WithHTTPClient(newMockClient(rt)),
		option.WithMaxRetries(0),
		option.WithMiddleware(Middleware("test", WithTracerProvider(provider))),
	)
	status := func() codes.Code { return requireSingleSpan(t, provider, exporter).Status().Code }
	detail := func() (string, map[string]string) {
		span := requireSingleSpan(t, provider, exporter)
		attrs := map[string]string{}
		for k, v := range spanAttrs(span) {
			attrs[string(k)] = v.Emit()
		}
		return span.Status().Description, attrs
	}
	return client, status, detail
}

func TestMiddleware_ErrorEnvelope(t *testing.T) {
	const envelope = `{"error":{"message":"upstream provider failed","type":"provider_error"}}`

	// @scenario "A 200 carrying the error envelope marks the span as an error"
	t.Run("a 200 carrying the error envelope marks the span as an error", func(t *testing.T) {
		client, status, detail := envelopeClient(t, envelope)

		resp, err := client.Chat.Completions.New(context.Background(), benchParams())
		require.NoError(t, err, "the caller's call is not turned into an error")
		assert.JSONEq(t, envelope, resp.RawJSON(), "the caller receives the body untouched")

		assert.Equal(t, codes.Error, status())
		msg, attrs := detail()
		assert.Equal(t, "upstream provider failed", msg)
		assert.Equal(t, "provider_error", attrs[string(semconv.ErrorTypeKey)])
	})

	// @scenario "An envelope without a message falls back to a generic one"
	t.Run("an envelope without a message falls back to a generic one", func(t *testing.T) {
		client, status, detail := envelopeClient(t, `{"error":{}}`)

		_, err := client.Chat.Completions.New(context.Background(), benchParams())
		require.NoError(t, err)

		assert.Equal(t, codes.Error, status())
		msg, attrs := detail()
		assert.Equal(t, "completion returned an error body", msg)
		_, hasType := attrs[string(semconv.ErrorTypeKey)]
		assert.False(t, hasType)
	})

	// @scenario "A chat completion object carrying the envelope is an error too"
	t.Run("a chat completion object carrying the envelope is an error too", func(t *testing.T) {
		client, status, _ := envelopeClient(t, `{"object":"chat.completion","choices":[],"error":{"message":"boom"}}`)

		_, err := client.Chat.Completions.New(context.Background(), benchParams())
		require.NoError(t, err)
		assert.Equal(t, codes.Error, status())
	})

	// @scenario "A 200 with neither choices nor an error is not an error"
	t.Run("a 200 with neither choices nor an error stays Ok", func(t *testing.T) {
		client, status, _ := envelopeClient(t, `{"id":"x","object":"chat.completion","choices":[]}`)

		_, err := client.Chat.Completions.New(context.Background(), benchParams())
		require.NoError(t, err)
		assert.Equal(t, codes.Ok, status())
	})

	// @scenario "A completion with choices and a null error is not an error"
	t.Run("a completion with choices and a null error stays Ok", func(t *testing.T) {
		body := `{"id":"x","object":"chat.completion","error":null,"choices":[{"index":0,"finish_reason":"stop","message":{"role":"assistant","content":"hi"}}]}`
		client, status, _ := envelopeClient(t, body)

		_, err := client.Chat.Completions.New(context.Background(), benchParams())
		require.NoError(t, err)
		assert.Equal(t, codes.Ok, status())
	})
}
