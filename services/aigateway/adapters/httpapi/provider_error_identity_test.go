package httpapi

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/tidwall/gjson"
	"go.uber.org/zap"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/pkg/breaker"
	"github.com/langwatch/langwatch/services/aigateway/adapters/providers"
	"github.com/langwatch/langwatch/services/aigateway/app"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// Incident regression suite: while the upstream OpenAI account was out of
// credits, requests through the gateway's openai lane reached clients as
// HTTP 500 {"error":{"type":"internal_error"}} instead of OpenAI's own 429
// insufficient_quota. These tests run the REAL dispatch stack (bifrost
// against a local upstream) and pin the wire contract end to end: the
// provider's status class and error identity survive, and the circuit
// breaker can no longer manufacture an internal_error.
//
// Spec: specs/ai-gateway/error-transparency.feature

// upstreamStub answers every request with a fixed provider error.
func upstreamStub(status int, body string, headers map[string]string) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		for k, v := range headers {
			w.Header().Set(k, v)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
}

func openAILaneRouter(t *testing.T, backendURL string, opts ...app.Option) http.Handler {
	t.Helper()
	bf, err := providers.NewBifrostRouter(context.Background(), providers.BifrostOptions{
		Logger:           zap.NewNop(),
		OpenAIBackendURL: backendURL,
	})
	require.NoError(t, err)
	t.Cleanup(bf.Close)

	auth := &mockAuth{resolveFn: func(_ context.Context, _ string) (*domain.Bundle, error) {
		return testBundle(), nil
	}}
	base := []app.Option{
		app.WithAuth(auth),
		app.WithProviders(bf),
		app.WithLogger(zap.NewNop()),
	}
	return buildRouter(append(base, opts...)...)
}

func openAIChatRequest(stream bool) *http.Request {
	body := `{"model":"openai/gpt-5-mini","messages":[{"role":"user","content":"hi"}]}`
	if stream {
		body = `{"model":"openai/gpt-5-mini","messages":[{"role":"user","content":"hi"}],"stream":true}`
	}
	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", bytes.NewReader([]byte(body)))
	req.Header.Set("Authorization", "Bearer vk-lw-test")
	return req
}

// @scenario "Provider error taxonomy keeps status and identity through the gateway"
func TestOpenAILane_ProviderErrorTaxonomy(t *testing.T) {
	cases := []struct {
		name string
		// upstream answer
		status  int
		body    string
		headers map[string]string
		// expected at the gateway's wire
		wantStatus int
		wantType   string
		wantCode   string
		// insufficient_quota bodies get the governance message rewrite;
		// everything else must be byte-identical.
		wantVerbatimBody bool
	}{
		{
			name:       "429 insufficient_quota keeps identity, message is governed",
			status:     429,
			body:       `{"error":{"message":"You exceeded your current quota, please check your plan and billing details.","type":"insufficient_quota","param":null,"code":"insufficient_quota"}}`,
			headers:    map[string]string{"Retry-After": "17"},
			wantStatus: 429,
			wantType:   "insufficient_quota",
			wantCode:   "insufficient_quota",
		},
		{
			name:             "429 rate_limit_exceeded is forwarded verbatim",
			status:           429,
			body:             `{"error":{"message":"Rate limit reached for gpt-5-mini in organization org-x on tokens per min.","type":"requests","param":null,"code":"rate_limit_exceeded"}}`,
			headers:          map[string]string{"Retry-After": "2"},
			wantStatus:       429,
			wantType:         "requests",
			wantCode:         "rate_limit_exceeded",
			wantVerbatimBody: true,
		},
		{
			name:             "401 invalid_api_key is forwarded verbatim",
			status:           401,
			body:             `{"error":{"message":"Incorrect API key provided: sk-test.","type":"invalid_request_error","param":null,"code":"invalid_api_key"}}`,
			wantStatus:       401,
			wantType:         "invalid_request_error",
			wantCode:         "invalid_api_key",
			wantVerbatimBody: true,
		},
		{
			name:             "404 model_not_found is forwarded verbatim",
			status:           404,
			body:             `{"error":{"message":"The model 'nope' does not exist or you do not have access to it.","type":"invalid_request_error","param":"model","code":"model_not_found"}}`,
			wantStatus:       404,
			wantType:         "invalid_request_error",
			wantCode:         "model_not_found",
			wantVerbatimBody: true,
		},
		{
			name:             "400 invalid_request_error is forwarded verbatim",
			status:           400,
			body:             `{"error":{"message":"Invalid value for 'messages': empty array.","type":"invalid_request_error","param":"messages","code":null}}`,
			wantStatus:       400,
			wantType:         "invalid_request_error",
			wantVerbatimBody: true,
		},
		{
			name:             "500 server_error stays a provider 5xx",
			status:           500,
			body:             `{"error":{"message":"The server had an error while processing your request.","type":"server_error","param":null,"code":null}}`,
			wantStatus:       500,
			wantType:         "server_error",
			wantVerbatimBody: true,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			backend := upstreamStub(tc.status, tc.body, tc.headers)
			defer backend.Close()
			router := openAILaneRouter(t, backend.URL)

			for _, stream := range []bool{false, true} {
				name := map[bool]string{false: "non-stream", true: "stream"}[stream]
				t.Run(name, func(t *testing.T) {
					rec := httptest.NewRecorder()
					router.ServeHTTP(rec, openAIChatRequest(stream))

					require.Equal(t, tc.wantStatus, rec.Code,
						"the provider's status class must reach the client untouched")
					got := rec.Body.String()
					assert.Equal(t, tc.wantType, gjson.Get(got, "error.type").String())
					if tc.wantCode != "" {
						assert.Equal(t, tc.wantCode, gjson.Get(got, "error.code").String())
					}
					assert.NotContains(t, got, "internal_error",
						"a provider verdict must never surface as the gateway's internal_error")
					if tc.wantVerbatimBody {
						assert.JSONEq(t, tc.body, got, "the provider's native body must be forwarded byte-for-byte")
					}
					for k, v := range tc.headers {
						assert.Equal(t, v, rec.Header().Get(k), "retry-signaling header %s must be forwarded", k)
					}
					assert.Equal(t, "openai", rec.Header().Get("X-LangWatch-Provider"),
						"the error must say which upstream produced it")
				})
			}
		})
	}
}

// @scenario "Upstream error responses name the provider that produced them"
//
// The anthropic rows that differ structurally from OpenAI's: the 529
// overloaded_error (a status outside the IANA registry that must still pass
// through untouched) and the 429 rate_limit_error. Routed through the REAL
// bifrost anthropic-compat lane (credential base_url pinned to the stub).
func TestMessagesLane_AnthropicErrorTaxonomy(t *testing.T) {
	cases := []struct {
		name       string
		status     int
		body       string
		wantStatus int
		wantType   string
	}{
		{
			name:       "529 overloaded_error passes through",
			status:     529,
			body:       `{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}`,
			wantStatus: 529,
			wantType:   "overloaded_error",
		},
		{
			name:       "429 rate_limit_error passes through",
			status:     429,
			body:       `{"type":"error","error":{"type":"rate_limit_error","message":"Number of request tokens has exceeded your per-minute rate limit"}}`,
			wantStatus: 429,
			wantType:   "rate_limit_error",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			backend := upstreamStub(tc.status, tc.body, nil)
			defer backend.Close()

			bf, err := providers.NewBifrostRouter(context.Background(), providers.BifrostOptions{Logger: zap.NewNop()})
			require.NoError(t, err)
			t.Cleanup(bf.Close)

			bundle := testBundle()
			bundle.Credentials = []domain.Credential{{
				ID:         "cred-anthropic",
				ProviderID: domain.ProviderAnthropic,
				APIKey:     "sk-ant-test",
				Extra:      map[string]string{"base_url": backend.URL},
			}}
			auth := &mockAuth{resolveFn: func(_ context.Context, _ string) (*domain.Bundle, error) {
				return bundle, nil
			}}
			router := buildRouter(
				app.WithAuth(auth),
				app.WithProviders(bf),
				app.WithLogger(zap.NewNop()),
			)

			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, messagesRequest(false))

			require.Equal(t, tc.wantStatus, rec.Code,
				"anthropic's status must pass through untouched, got body %s", rec.Body.String())
			assert.Equal(t, tc.wantType, gjson.Get(rec.Body.String(), "error.type").String())
			assert.Equal(t, "anthropic", rec.Header().Get("X-LangWatch-Provider"))
		})
	}
}

// @scenario "Provider 4xx answers do not open the circuit breaker"
//
// The incident's exact mechanics: CI bots hammered the lane while OpenAI
// answered 429 insufficient_quota; the 429s counted as breaker failures,
// the breaker opened, and the zero-attempt walk surfaced 500 internal_error.
// Answered 4xx must not move the breaker, so every request keeps relaying
// the provider's own 429 no matter how many came before it.
func TestOpenAILane_QuotaOutageNeverBecomesInternalError(t *testing.T) {
	backend := upstreamStub(429,
		`{"error":{"message":"You exceeded your current quota, please check your plan and billing details.","type":"insufficient_quota","param":null,"code":"insufficient_quota"}}`,
		nil)
	defer backend.Close()

	// Real breaker at the production wiring point, with a threshold low
	// enough that the old failure accounting would trip it immediately.
	circuits := breaker.NewRegistry(breaker.Options{
		Threshold:    2,
		Window:       time.Minute,
		OpenDuration: time.Hour,
	})
	router := openAILaneRouter(t, backend.URL, app.WithCircuitBreaker(circuits))

	for i := 0; i < 8; i++ {
		stream := i%2 == 1
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, openAIChatRequest(stream))

		require.Equal(t, http.StatusTooManyRequests, rec.Code,
			"request %d (stream=%v): the provider's 429 must keep relaying, got body %s", i, stream, rec.Body.String())
		assert.Equal(t, "insufficient_quota", gjson.Get(rec.Body.String(), "error.code").String())
	}
}

// @scenario "An open circuit breaker surfaces circuit_open, not internal_error"
//
// When the breaker HAS legitimately opened (a real provider outage: 5xx
// storm), the zero-attempt walk must answer with a typed, retryable
// circuit_open. The incident showed it answering 500 internal_error, which
// reads as a gateway bug and tells the client nothing actionable.
func TestOpenAILane_OpenBreakerSurfacesCircuitOpen(t *testing.T) {
	backend := upstreamStub(503,
		`{"error":{"message":"The engine is currently overloaded, please try again later","type":"server_error","param":null,"code":null}}`,
		nil)
	defer backend.Close()

	circuits := breaker.NewRegistry(breaker.Options{
		Threshold:    2,
		Window:       time.Minute,
		OpenDuration: time.Hour,
	})
	router := openAILaneRouter(t, backend.URL, app.WithCircuitBreaker(circuits))

	// Two 503 answers open the breaker (5xx IS a slot-health failure).
	for i := 0; i < 2; i++ {
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, openAIChatRequest(false))
		require.Equal(t, http.StatusServiceUnavailable, rec.Code)
		assert.Equal(t, "server_error", gjson.Get(rec.Body.String(), "error.type").String(),
			"while the breaker is closed the provider's own 5xx body is forwarded")
	}

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, openAIChatRequest(false))

	require.Equal(t, http.StatusServiceUnavailable, rec.Code,
		"an open breaker is a retryable provider-side condition, not an internal error")
	got := rec.Body.String()
	assert.Equal(t, "circuit_open", gjson.Get(got, "error.code").String(),
		"the envelope must name the real condition; the incident surfaced internal_error here, got %s", got)
	assert.Equal(t, "provider", gjson.Get(got, "error.fault").String())
	assert.NotContains(t, got, "internal_error")
}
