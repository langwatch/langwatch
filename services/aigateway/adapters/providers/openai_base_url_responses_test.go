package providers

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// An OpenAI credential with a base URL maps to bifrost's vLLM provider, which
// has no Responses route. The Responses lane forwards the caller's body as it
// arrived, so that provider posted a Responses body to /v1/chat/completions.
// api.openai.com answers that with 400 "Missing required parameter:
// 'messages'", for every model, with OPENAI_BASE_URL set to the default
// https://api.openai.com/v1 as much as to a proxy.
//
// These tests run the real bifrost pipeline against a local server that
// records what it was sent.
//
// Spec: specs/ai-gateway/custom-provider-base-url.feature

type recordedUpstream struct {
	mu     sync.Mutex
	path   string
	body   string
	auth   string
	hits   int
	server *httptest.Server
}

func (u *recordedUpstream) snapshot() (path, body, auth string, hits int) {
	u.mu.Lock()
	defer u.mu.Unlock()
	return u.path, u.body, u.auth, u.hits
}

// newRecordedUpstream answers every request with a small JSON body under the
// given status, after recording the path, body and Authorization header.
func newRecordedUpstream(t *testing.T, status int, answer string) *recordedUpstream {
	t.Helper()
	u := &recordedUpstream{}
	u.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		u.mu.Lock()
		u.path, u.body, u.auth = r.URL.Path, string(body), r.Header.Get("Authorization")
		u.hits++
		u.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = w.Write([]byte(answer))
	}))
	t.Cleanup(u.server.Close)
	return u
}

const responsesAnswer = `{"id":"resp_1","object":"response","status":"completed","model":"gpt-5.6-terra","output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"hi"}]}],"usage":{"input_tokens":3,"output_tokens":1,"total_tokens":4}}`

func openAIResponsesRequest(body string) *domain.Request {
	return &domain.Request{
		Type:     domain.RequestTypeResponses,
		Model:    "openai/gpt-5.6-terra",
		Body:     []byte(body),
		Resolved: &domain.ResolvedModel{ProviderID: domain.ProviderOpenAI, ModelID: "gpt-5.6-terra"},
	}
}

// @scenario "OpenAI provider with a base URL serves the Responses API at that URL"
func TestOpenAIBaseURL_ResponsesReachTheResponsesRoute(t *testing.T) {
	const body = `{"model":"gpt-5.6-terra","input":[{"role":"user","content":[{"type":"input_text","text":"say hi"}]}],"reasoning":{"effort":"low"},"store":false}`

	// Every shape a customer types for the same endpoint.
	shapes := map[string]func(base string) string{
		"with /v1":              func(base string) string { return base + "/v1" },
		"with /v1 and a slash":  func(base string) string { return base + "/v1/" },
		"without /v1":           func(base string) string { return base },
		"with a trailing slash": func(base string) string { return base + "/" },
	}
	for name, shape := range shapes {
		t.Run(name, func(t *testing.T) {
			upstream := newRecordedUpstream(t, http.StatusOK, responsesAnswer)
			router := newTestRouter(t)

			resp, err := router.Dispatch(context.Background(), openAIResponsesRequest(body), domain.Credential{
				ID:         "cred-1",
				ProviderID: domain.ProviderOpenAI,
				APIKey:     "sk-test",
				Extra:      map[string]string{"base_url": shape(upstream.server.URL)},
			})
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, resp.StatusCode)

			path, sent, auth, hits := upstream.snapshot()
			assert.Equal(t, 1, hits)
			assert.Equal(t, "/v1/responses", path,
				"a Responses request must reach the endpoint's Responses route, not chat completions")
			assert.JSONEq(t, body, sent, "the caller's Responses body is forwarded as it arrived")
			assert.Equal(t, "Bearer sk-test", auth)
			assert.Contains(t, string(resp.Body), `"resp_1"`)
		})
	}
}

// @scenario "OpenAI provider with a base URL serves the Responses API at that URL"
func TestOpenAIBaseURL_StreamingResponsesReachTheResponsesRoute(t *testing.T) {
	upstream := newRecordedUpstream(t, http.StatusTeapot, `{"error":{"message":"teapot","type":"invalid_request_error"}}`)
	router := newTestRouter(t)

	_, err := router.DispatchStream(
		context.Background(),
		openAIResponsesRequest(`{"model":"gpt-5.6-terra","input":"hi","stream":true}`),
		domain.Credential{
			ID:         "cred-1",
			ProviderID: domain.ProviderOpenAI,
			APIKey:     "sk-test",
			Extra:      map[string]string{"base_url": upstream.server.URL + "/v1"},
		},
	)

	// The local server refuses on purpose: what matters is where the request
	// went, and that its own answer came back rather than a gateway verdict.
	var ue *domain.UpstreamError
	require.ErrorAs(t, err, &ue)
	assert.Equal(t, http.StatusTeapot, ue.StatusCode)
	path, _, _, _ := upstream.snapshot()
	assert.Equal(t, "/v1/responses", path)
}

// @scenario "An unauthenticated OpenAI-compatible endpoint serves the Responses API without a key"
func TestOpenAIBaseURL_KeylessResponsesAreNotRefused(t *testing.T) {
	upstream := newRecordedUpstream(t, http.StatusOK, responsesAnswer)
	router := newTestRouter(t)

	resp, err := router.Dispatch(
		context.Background(),
		openAIResponsesRequest(`{"model":"gpt-5.6-terra","input":"hi"}`),
		domain.Credential{
			ID:         "cred-1",
			ProviderID: domain.ProviderOpenAI,
			Extra:      map[string]string{"base_url": upstream.server.URL + "/v1"},
		},
	)
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, resp.StatusCode)

	path, _, auth, _ := upstream.snapshot()
	assert.Equal(t, "/v1/responses", path)
	assert.Empty(t, auth, "no bearer token is invented for an endpoint that takes none")
}

// @scenario "OpenAI provider with a base URL override routes to that URL"
func TestOpenAIBaseURL_ChatCompletionsKeepTheirRoute(t *testing.T) {
	upstream := newRecordedUpstream(t, http.StatusOK,
		`{"id":"c1","object":"chat.completion","model":"gpt-5.6-terra","choices":[{"index":0,"message":{"role":"assistant","content":"hi"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}`)
	router := newTestRouter(t)

	_, err := router.Dispatch(
		context.Background(),
		&domain.Request{
			Type:     domain.RequestTypeChat,
			Model:    "openai/gpt-5.6-terra",
			Body:     []byte(`{"model":"gpt-5.6-terra","messages":[{"role":"user","content":"hi"}]}`),
			Resolved: &domain.ResolvedModel{ProviderID: domain.ProviderOpenAI, ModelID: "gpt-5.6-terra"},
		},
		domain.Credential{
			ID:         "cred-1",
			ProviderID: domain.ProviderOpenAI,
			APIKey:     "sk-test",
			Extra:      map[string]string{"base_url": upstream.server.URL + "/v1"},
		},
	)
	require.NoError(t, err)

	path, _, _, _ := upstream.snapshot()
	assert.Equal(t, "/v1/chat/completions", path)
}

// Two endpoints must never share a bifrost provider: the derived key is what
// carries the base URL, so a collision would send one tenant's request to the
// other's endpoint.
// @scenario "Two OpenAI providers with different base URLs stay isolated on the Responses API"
func TestOpenAIBaseURL_TwoEndpointsStayIsolated(t *testing.T) {
	first := newRecordedUpstream(t, http.StatusOK, responsesAnswer)
	second := newRecordedUpstream(t, http.StatusOK, responsesAnswer)
	router := newTestRouter(t)

	for _, upstream := range []*recordedUpstream{first, second} {
		_, err := router.Dispatch(
			context.Background(),
			openAIResponsesRequest(`{"model":"gpt-5.6-terra","input":"hi"}`),
			domain.Credential{
				ID:         "cred-" + upstream.server.URL,
				ProviderID: domain.ProviderOpenAI,
				APIKey:     "sk-test",
				Extra:      map[string]string{"base_url": upstream.server.URL},
			},
		)
		require.NoError(t, err)
	}

	_, _, _, firstHits := first.snapshot()
	_, _, _, secondHits := second.snapshot()
	assert.Equal(t, 1, firstHits)
	assert.Equal(t, 1, secondHits)
}
