package googlegenai

import (
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	semconv "go.opentelemetry.io/otel/semconv/v1.41.0"

	"google.golang.org/genai"
)

func TestParseOperation(t *testing.T) {
	cases := []struct {
		name       string
		path       string
		wantModel  string
		wantAction string
	}{
		{
			name:       "gemini api generateContent",
			path:       "/v1beta/models/gemini-2.5-flash:generateContent",
			wantModel:  "gemini-2.5-flash",
			wantAction: "generateContent",
		},
		{
			name:       "gemini api streamGenerateContent",
			path:       "/v1beta/models/gemini-2.5-pro:streamGenerateContent",
			wantModel:  "gemini-2.5-pro",
			wantAction: "streamGenerateContent",
		},
		{
			name:       "tuned model",
			path:       "/v1beta/tunedModels/my-tuned-model:generateContent",
			wantModel:  "my-tuned-model",
			wantAction: "generateContent",
		},
		{
			name:       "vertex ai publishers path",
			path:       "/v1beta1/projects/p/locations/us-central1/publishers/google/models/gemini-2.5-flash:generateContent",
			wantModel:  "gemini-2.5-flash",
			wantAction: "generateContent",
		},
		{
			name:       "embedContent",
			path:       "/v1beta/models/text-embedding-004:embedContent",
			wantModel:  "text-embedding-004",
			wantAction: "embedContent",
		},
		{
			name:       "non-model path yields no model",
			path:       "/v1beta/cachedContents",
			wantModel:  "",
			wantAction: "",
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			op := parseOperation(c.path)
			assert.Equal(t, c.wantModel, op.model)
			assert.Equal(t, c.wantAction, op.action)
		})
	}
}

func TestOperationAttrs(t *testing.T) {
	t.Run("generateContent maps to generate_content with model", func(t *testing.T) {
		attrs := operationAttrs("/v1beta/models/gemini-2.5-flash:generateContent")
		m := map[string]string{}
		for _, kv := range attrs {
			m[string(kv.Key)] = kv.Value.AsString()
		}
		assert.Equal(t, "gemini-2.5-flash", m[string(semconv.GenAIRequestModelKey)])
		assert.Equal(t, "generate_content", m[string(semconv.GenAIOperationNameKey)])
	})

	t.Run("embedContent maps to embeddings", func(t *testing.T) {
		attrs := operationAttrs("/v1beta/models/text-embedding-004:embedContent")
		m := map[string]string{}
		for _, kv := range attrs {
			m[string(kv.Key)] = kv.Value.AsString()
		}
		assert.Equal(t, "embeddings", m[string(semconv.GenAIOperationNameKey)])
	})

	t.Run("non-model path yields no attributes", func(t *testing.T) {
		assert.Empty(t, operationAttrs("/v1beta/cachedContents"))
	})

	t.Run("an unmapped verb is normalised to snake_case", func(t *testing.T) {
		assert.Equal(t, "predict", operationName("predict"))
		assert.Equal(t, "stream_raw_predict", operationName("streamRawPredict"))
		assert.Equal(t, "count_tokens", operationName("countTokens"))
		assert.Empty(t, operationName(""))
	})
}

// baseMarkerTransport is a sentinel base round tripper that counts the requests
// it serves, used to assert that an existing client transport really stays in
// the chain underneath the tracing layer.
type baseMarkerTransport struct{ hits int }

func (t *baseMarkerTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	t.hits++
	return &http.Response{
		StatusCode: http.StatusOK,
		Header:     http.Header{"Content-Type": []string{"application/json"}},
		Body:       io.NopCloser(strings.NewReader(`{}`)),
		Request:    req,
	}, nil
}

func TestWrapClientConfig(t *testing.T) {
	t.Run("it sets the HTTPClient on a nil-client config", func(t *testing.T) {
		cc := &genai.ClientConfig{APIKey: "k"}
		WrapClientConfig(cc)
		require.NotNil(t, cc.HTTPClient)
		assert.NotNil(t, cc.HTTPClient.Transport)
	})

	t.Run("it preserves an existing client transport as the base", func(t *testing.T) {
		base := &baseMarkerTransport{}
		cc := &genai.ClientConfig{APIKey: "k", HTTPClient: &http.Client{Transport: base}}
		WrapClientConfig(cc)
		require.NotNil(t, cc.HTTPClient)

		// Drive a request through the wrapped client: the marker must serve it, so
		// the user's transport is provably still underneath the tracing layer.
		req, err := http.NewRequest(http.MethodPost,
			"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
			strings.NewReader(`{}`))
		require.NoError(t, err)
		resp, err := cc.HTTPClient.Do(req)
		require.NoError(t, err)
		require.NoError(t, resp.Body.Close())

		assert.Equal(t, 1, base.hits, "the traced transport must delegate to the original base transport")
	})

	t.Run("it is a no-op on a nil config", func(t *testing.T) {
		assert.NotPanics(t, func() { WrapClientConfig(nil) })
	})
}
