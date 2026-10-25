package gateway

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/aigateway/dispatcher"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/channels"
)

// embedAgainst runs a real Embed of two inputs against a provider answering body.
func embedAgainst(t *testing.T, body string) (channels.EmbeddingResponse, error) {
	t.Helper()
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(upstream.Close)
	disp, err := dispatcher.New(t.Context(), dispatcher.Options{})
	require.NoError(t, err)
	t.Cleanup(disp.Close)
	return New(Options{Dispatcher: disp}).Embed(t.Context(), channels.EmbeddingRequest{
		Tenant: tenant(map[string]string{
			"X_LITELLM_EMBEDDINGS_api_key":  "sk-acme",
			"X_LITELLM_EMBEDDINGS_api_base": upstream.URL + "/v1",
		}),
		Model:  "openai/text-embedding-3-small",
		Inputs: []string{"first", "second"},
	})
}

// @scenario "An incomplete embeddings answer fails the entry instead of scoring it"
func TestAnIncompleteEmbeddingsAnswerFailsTheCall(t *testing.T) {
	const usage = `"usage":{"prompt_tokens":2,"total_tokens":2}`
	complete, err := embedAgainst(t, `{"object":"list","model":"text-embedding-3-small","data":[`+
		`{"object":"embedding","index":1,"embedding":[0.3,0.4]},{"object":"embedding","index":0,"embedding":[0.1,0.2]}],`+usage+`}`)
	require.NoError(t, err)
	assert.Equal(t, [][]float64{{0.1, 0.2}, {0.3, 0.4}}, complete.Vectors, "vectors follow input order")

	for name, data := range map[string]string{
		"a missing slot":     `{"object":"embedding","index":0,"embedding":[0.1,0.2]}`,
		"a repeated slot":    `{"object":"embedding","index":0,"embedding":[0.1,0.2]},{"object":"embedding","index":0,"embedding":[0.3,0.4]}`,
		"an empty vector":    `{"object":"embedding","index":0,"embedding":[0.1,0.2]},{"object":"embedding","index":1,"embedding":[]}`,
		"an out-of-range":    `{"object":"embedding","index":0,"embedding":[0.1,0.2]},{"object":"embedding","index":2,"embedding":[0.3,0.4]}`,
		"unequal dimensions": `{"object":"embedding","index":0,"embedding":[0.1,0.2]},{"object":"embedding","index":1,"embedding":[0.3]}`,
	} {
		t.Run(name, func(t *testing.T) {
			_, err := embedAgainst(t, `{"object":"list","model":"text-embedding-3-small","data":[`+data+`],`+usage+`}`)
			require.ErrorContains(t, err, "embedding", "the channel, not the dispatcher, refuses it")
		})
	}
}
