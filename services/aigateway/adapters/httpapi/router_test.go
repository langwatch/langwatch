package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/health"
	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/app"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// --- Mock implementations ---

type mockAuth struct {
	resolveFn func(ctx context.Context, token string) (*domain.Bundle, error)
}

func (m *mockAuth) Resolve(ctx context.Context, token string) (*domain.Bundle, error) {
	return m.resolveFn(ctx, token)
}

type mockProvider struct {
	dispatchFn func(ctx context.Context, req *domain.Request, cred domain.Credential) (*domain.Response, error)
}

func (m *mockProvider) Dispatch(ctx context.Context, req *domain.Request, cred domain.Credential) (*domain.Response, error) {
	return m.dispatchFn(ctx, req, cred)
}

func (m *mockProvider) DispatchStream(_ context.Context, _ *domain.Request, _ domain.Credential) (domain.StreamIterator, error) {
	return nil, nil
}

func (m *mockProvider) ListModels(_ context.Context, _ []domain.Credential) ([]domain.Model, error) {
	return nil, nil
}

type mockRateLimiter struct {
	allowFn func(ctx context.Context, vkID string, limits domain.RateLimits) error
}

func (m *mockRateLimiter) Allow(ctx context.Context, vkID string, limits domain.RateLimits) error {
	if m.allowFn != nil {
		return m.allowFn(ctx, vkID, limits)
	}
	return nil
}

type mockBudget struct {
	precheckFn func(ctx context.Context, bundle *domain.Bundle) (domain.BudgetVerdict, error)
}

func (m *mockBudget) Precheck(ctx context.Context, bundle *domain.Bundle) (domain.BudgetVerdict, error) {
	if m.precheckFn != nil {
		return m.precheckFn(ctx, bundle)
	}
	return domain.BudgetAllow, nil
}

func (m *mockBudget) Debit(_ context.Context, _ *domain.Bundle, _ domain.Usage) {}

// --- Helpers ---

func testBundle() *domain.Bundle {
	return &domain.Bundle{
		VirtualKeyID: "vk-test",
		ProjectID:    "proj-test",
		TeamID:       "team-test",
		Credentials: []domain.Credential{
			{ID: "cred-1", ProviderID: domain.ProviderOpenAI, APIKey: "sk-test"},
		},
		Config: domain.BundleConfig{
			Fallback: domain.FallbackConfig{MaxAttempts: 1},
		},
	}
}

func successResponse() *domain.Response {
	return &domain.Response{
		Body:       []byte(`{"choices":[{"message":{"content":"hello"}}]}`),
		StatusCode: 200,
		Usage:      domain.Usage{PromptTokens: 5, CompletionTokens: 3, TotalTokens: 8},
	}
}

func chatBody() []byte {
	return []byte(`{"model":"gpt-4","messages":[{"role":"user","content":"hi"}]}`)
}

func buildRouter(opts ...app.Option) http.Handler {
	reg := health.New("test")
	reg.MarkStarted()
	application := app.New(opts...)
	return NewRouter(RouterDeps{
		App:    application,
		Logger: zap.NewNop(),
		Health: reg,
	})
}

func buildRouterWithVersion(version string, opts ...app.Option) http.Handler {
	reg := health.New(version)
	reg.MarkStarted()
	application := app.New(opts...)
	return NewRouter(RouterDeps{
		App:     application,
		Logger:  zap.NewNop(),
		Health:  reg,
		Version: version,
	})
}

// --- Tests ---

func TestRouter_HealthEndpoints(t *testing.T) {
	router := buildRouter()

	endpoints := []string{"/healthz", "/readyz", "/startupz"}
	for _, ep := range endpoints {
		t.Run(ep, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, ep, nil)
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, req)
			assert.Equal(t, http.StatusOK, rec.Code)
		})
	}
}

func TestRouter_AuthMiddleware_MissingToken(t *testing.T) {
	auth := &mockAuth{
		resolveFn: func(_ context.Context, _ string) (*domain.Bundle, error) {
			return testBundle(), nil
		},
	}
	provider := &mockProvider{
		dispatchFn: func(_ context.Context, _ *domain.Request, _ domain.Credential) (*domain.Response, error) {
			return successResponse(), nil
		},
	}

	router := buildRouter(
		app.WithAuth(auth),
		app.WithProviders(provider),
		app.WithLogger(zap.NewNop()),
	)

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", bytes.NewReader(chatBody()))
	req.Header.Set("Content-Type", "application/json")
	// No Authorization header.
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusUnauthorized, rec.Code)

	var errResp herr.ErrorResponse
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&errResp))
	assert.Equal(t, string(domain.ErrInvalidAPIKey), errResp.Error.Type)
}

func TestRouter_AuthMiddleware_ValidToken(t *testing.T) {
	auth := &mockAuth{
		resolveFn: func(_ context.Context, token string) (*domain.Bundle, error) {
			if token == "lw_vk_test" {
				return testBundle(), nil
			}
			return nil, herr.New(context.Background(), domain.ErrInvalidAPIKey, nil)
		},
	}
	provider := &mockProvider{
		dispatchFn: func(_ context.Context, _ *domain.Request, _ domain.Credential) (*domain.Response, error) {
			return successResponse(), nil
		},
	}

	router := buildRouter(
		app.WithAuth(auth),
		app.WithProviders(provider),
		app.WithLogger(zap.NewNop()),
	)

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", bytes.NewReader(chatBody()))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer lw_vk_test")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusOK, rec.Code)

	body, err := io.ReadAll(rec.Body)
	require.NoError(t, err)
	assert.JSONEq(t, `{"choices":[{"message":{"content":"hello"}}]}`, string(body))
}

// X-Goog-Api-Key — Gemini SDK / gemini-cli's canonical auth header.
// Verifying the gateway accepts it lets gemini-native clients
// (gemini-cli, @google/genai SDK) point at the gateway with no auth
// changes — the VK secret slots into the same place a Google API key
// would normally go.
func TestRouter_AuthMiddleware_XGoogApiKey(t *testing.T) {
	auth := &mockAuth{
		resolveFn: func(_ context.Context, token string) (*domain.Bundle, error) {
			if token == "lw_vk_test" {
				return testBundle(), nil
			}
			return nil, herr.New(context.Background(), domain.ErrInvalidAPIKey, nil)
		},
	}
	provider := &mockProvider{
		dispatchFn: func(_ context.Context, _ *domain.Request, _ domain.Credential) (*domain.Response, error) {
			return successResponse(), nil
		},
	}

	router := buildRouter(
		app.WithAuth(auth),
		app.WithProviders(provider),
		app.WithLogger(zap.NewNop()),
	)

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", bytes.NewReader(chatBody()))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Goog-Api-Key", "lw_vk_test")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusOK, rec.Code)
}

func TestRouter_AuthMiddleware_XApiKey(t *testing.T) {
	auth := &mockAuth{
		resolveFn: func(_ context.Context, token string) (*domain.Bundle, error) {
			if token == "lw_vk_test" {
				return testBundle(), nil
			}
			return nil, herr.New(context.Background(), domain.ErrInvalidAPIKey, nil)
		},
	}
	provider := &mockProvider{
		dispatchFn: func(_ context.Context, _ *domain.Request, _ domain.Credential) (*domain.Response, error) {
			return successResponse(), nil
		},
	}

	router := buildRouter(
		app.WithAuth(auth),
		app.WithProviders(provider),
		app.WithLogger(zap.NewNop()),
	)

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", bytes.NewReader(chatBody()))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-api-key", "lw_vk_test")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusOK, rec.Code)
}

func TestRouter_DispatchError_RateLimited(t *testing.T) {
	auth := &mockAuth{
		resolveFn: func(_ context.Context, _ string) (*domain.Bundle, error) {
			return testBundle(), nil
		},
	}
	provider := &mockProvider{
		dispatchFn: func(_ context.Context, _ *domain.Request, _ domain.Credential) (*domain.Response, error) {
			return successResponse(), nil
		},
	}
	rl := &mockRateLimiter{
		allowFn: func(_ context.Context, _ string, _ domain.RateLimits) error {
			return fmt.Errorf("rpm exceeded")
		},
	}

	router := buildRouter(
		app.WithAuth(auth),
		app.WithProviders(provider),
		app.WithRateLimiter(rl),
		app.WithLogger(zap.NewNop()),
	)

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", bytes.NewReader(chatBody()))
	req.Header.Set("Authorization", "Bearer lw_vk_test")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusTooManyRequests, rec.Code)

	var errResp herr.ErrorResponse
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&errResp))
	assert.Equal(t, "rate_limited", errResp.Error.Type)
}

func TestRouter_DispatchError_BudgetExceeded(t *testing.T) {
	auth := &mockAuth{
		resolveFn: func(_ context.Context, _ string) (*domain.Bundle, error) {
			return testBundle(), nil
		},
	}
	provider := &mockProvider{
		dispatchFn: func(_ context.Context, _ *domain.Request, _ domain.Credential) (*domain.Response, error) {
			return successResponse(), nil
		},
	}
	budget := &mockBudget{
		precheckFn: func(_ context.Context, _ *domain.Bundle) (domain.BudgetVerdict, error) {
			return domain.BudgetBlock, nil
		},
	}

	router := buildRouter(
		app.WithAuth(auth),
		app.WithProviders(provider),
		app.WithBudget(budget),
		app.WithLogger(zap.NewNop()),
	)

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", bytes.NewReader(chatBody()))
	req.Header.Set("Authorization", "Bearer lw_vk_test")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusPaymentRequired, rec.Code)

	var errResp herr.ErrorResponse
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&errResp))
	assert.Equal(t, "budget_exceeded", errResp.Error.Type)
}

func TestRouter_MetaHeaders(t *testing.T) {
	auth := &mockAuth{
		resolveFn: func(_ context.Context, _ string) (*domain.Bundle, error) {
			return testBundle(), nil
		},
	}
	provider := &mockProvider{
		dispatchFn: func(_ context.Context, _ *domain.Request, _ domain.Credential) (*domain.Response, error) {
			return successResponse(), nil
		},
	}

	router := buildRouter(
		app.WithAuth(auth),
		app.WithProviders(provider),
		app.WithLogger(zap.NewNop()),
	)

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", bytes.NewReader(chatBody()))
	req.Header.Set("Authorization", "Bearer lw_vk_test")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusOK, rec.Code)
	assert.NotEmpty(t, rec.Header().Get("X-LangWatch-Gateway-Request-Id"))
}

// TestRouter_BodySizeCap_DefaultsTo32MiB pins the contract: a request
// strictly over the explicit cap is rejected with 413, a request below is
// accepted. Uses a small-ish 1 KiB cap so the test can fit a giant-enough
// body in memory without dominating the test suite. Zero-cap fallback is
// exercised implicitly by every other test in this file (buildRouter leaves
// MaxRequestBodyBytes unset → fallback to 32 MiB).
func TestRouter_BodySizeCap_RejectsOverLimit(t *testing.T) {
	auth := &mockAuth{
		resolveFn: func(_ context.Context, _ string) (*domain.Bundle, error) {
			return testBundle(), nil
		},
	}
	provider := &mockProvider{
		dispatchFn: func(_ context.Context, _ *domain.Request, _ domain.Credential) (*domain.Response, error) {
			return successResponse(), nil
		},
	}

	reg := health.New("test")
	reg.MarkStarted()
	application := app.New(
		app.WithAuth(auth),
		app.WithProviders(provider),
		app.WithLogger(zap.NewNop()),
	)
	router := NewRouter(RouterDeps{
		App:                 application,
		Logger:              zap.NewNop(),
		Health:              reg,
		MaxRequestBodyBytes: 1024,
	})

	// 2 KiB of padding wrapped in a minimally-valid chat body overruns the
	// 1 KiB cap — the MaxBytesReader trips at read time, the handler
	// surfaces it as 413.
	big := bytes.Repeat([]byte("x"), 2048)
	body := []byte(`{"model":"gpt-4","messages":[{"role":"user","content":"`)
	body = append(body, big...)
	body = append(body, []byte(`"}]}`)...)

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer lw_vk_test")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code < 400 {
		t.Fatalf("want 4xx (413 or similar), got %d; body: %s", rec.Code, rec.Body.String())
	}
}

func TestRouter_VersionHeader(t *testing.T) {
	auth := &mockAuth{
		resolveFn: func(_ context.Context, _ string) (*domain.Bundle, error) {
			return testBundle(), nil
		},
	}
	provider := &mockProvider{
		dispatchFn: func(_ context.Context, _ *domain.Request, _ domain.Credential) (*domain.Response, error) {
			return successResponse(), nil
		},
	}

	router := buildRouterWithVersion("1.0.0",
		app.WithAuth(auth),
		app.WithProviders(provider),
		app.WithLogger(zap.NewNop()),
	)

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", bytes.NewReader(chatBody()))
	req.Header.Set("Authorization", "Bearer lw_vk_test")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	assert.Equal(t, "1.0.0", rec.Header().Get("X-LangWatch-Gateway-Version"))
}

// Regression for the codex/opencode /v1/responses streaming
// misclassification bug: coding-agent bodies run 30-60 KiB, pushing
// the top-level `stream` flag past the 32 KiB default peek window.
// A miss routes a streaming request through the non-streaming
// handler, OpenAI returns 200+SSE, Bifrost can't unmarshal, client
// sees a 502 with SSE frames as the error body. The /v1/responses
// handler must peek far enough to still find `stream` at ~50 KiB.
func TestRouter_Responses_LargeBody_PicksStreamHandler(t *testing.T) {
	auth := &mockAuth{
		resolveFn: func(_ context.Context, _ string) (*domain.Bundle, error) {
			return testBundle(), nil
		},
	}

	syncCalled := false
	streamCalled := false
	provider := &mockStreamProvider{
		mockProvider: mockProvider{
			dispatchFn: func(_ context.Context, _ *domain.Request, _ domain.Credential) (*domain.Response, error) {
				syncCalled = true
				return successResponse(), nil
			},
		},
		dispatchStreamFn: func(_ context.Context, _ *domain.Request, _ domain.Credential) (domain.StreamIterator, error) {
			streamCalled = true
			return &emptyStreamIter{}, nil
		},
	}

	router := buildRouter(
		app.WithAuth(auth),
		app.WithProviders(provider),
		app.WithLogger(zap.NewNop()),
	)

	// Build a ~50 KiB /v1/responses body. The `instructions` string is
	// padded past 32 KiB so `stream` lands outside the default peek
	// window — same shape codex / opencode send in practice.
	padding := bytes.Repeat([]byte("x"), 40*1024)
	body := []byte(`{"model":"gpt-5-mini","input":"hi","instructions":"`)
	body = append(body, padding...)
	body = append(body, []byte(`","stream":true}`)...)
	require.Greater(t, len(body), 40*1024)

	req := httptest.NewRequest(http.MethodPost, "/v1/responses", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer lw_vk_test")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	require.False(t, syncCalled, "Responses handler routed large body with stream:true through non-streaming Dispatch")
	require.True(t, streamCalled, "Responses handler did not pick streaming path for stream:true beyond default peek window")
}

type mockStreamProvider struct {
	mockProvider
	dispatchStreamFn func(ctx context.Context, req *domain.Request, cred domain.Credential) (domain.StreamIterator, error)
}

func (m *mockStreamProvider) DispatchStream(ctx context.Context, req *domain.Request, cred domain.Credential) (domain.StreamIterator, error) {
	if m.dispatchStreamFn != nil {
		return m.dispatchStreamFn(ctx, req, cred)
	}
	return &emptyStreamIter{}, nil
}

type emptyStreamIter struct{}

func (*emptyStreamIter) Next(_ context.Context) bool { return false }
func (*emptyStreamIter) Chunk() []byte               { return nil }
func (*emptyStreamIter) Usage() domain.Usage         { return domain.Usage{} }
func (*emptyStreamIter) Err() error                  { return nil }
func (*emptyStreamIter) Close() error                { return nil }

func TestGeminiModelFromPath(t *testing.T) {
	cases := []struct {
		path string
		want string
	}{
		{"/models/gemini-2.5-flash:generateContent", "gemini-2.5-flash"},
		{"/models/gemini-2.5-pro:streamGenerateContent", "gemini-2.5-pro"},
		{"/models/gemini-1.5-flash-001:countTokens", "gemini-1.5-flash-001"},
		{"/models/gemini-2.5-flash", "gemini-2.5-flash"},
		{"/cachedContents", ""},
		{"/", ""},
	}
	for _, c := range cases {
		t.Run(c.path, func(t *testing.T) {
			assert.Equal(t, c.want, geminiModelFromPath(c.path))
		})
	}
}

// Regression for the Gemini-native passthrough route. gemini-cli's
// `GOOGLE_GEMINI_BASE_URL` makes it POST to /v1beta/models/{m}:generateContent
// (and :streamGenerateContent). The gateway must (1) accept the request,
// (2) extract model from URL path, (3) call the provider with
// RequestTypePassthrough, (4) forward method/path/query via req.Passthrough,
// (5) return the body + status code verbatim. Streaming path must pick
// DispatchStream instead of Dispatch.
func TestRouter_GeminiPassthrough_NonStreaming(t *testing.T) {
	auth := &mockAuth{
		resolveFn: func(_ context.Context, _ string) (*domain.Bundle, error) {
			return testBundle(), nil
		},
	}

	var gotReq *domain.Request
	provider := &mockProvider{
		dispatchFn: func(_ context.Context, req *domain.Request, _ domain.Credential) (*domain.Response, error) {
			gotReq = req
			return &domain.Response{
				Body:       []byte(`{"candidates":[{"content":{"parts":[{"text":"hi"}]}}]}`),
				StatusCode: 200,
				Headers:    map[string]string{"Content-Type": "application/json; charset=UTF-8"},
			}, nil
		},
	}

	router := buildRouter(
		app.WithAuth(auth),
		app.WithProviders(provider),
		app.WithLogger(zap.NewNop()),
	)

	geminiBody := []byte(`{"contents":[{"role":"user","parts":[{"text":"hi"}]}]}`)
	req := httptest.NewRequest(http.MethodPost, "/v1beta/models/gemini-2.5-flash:generateContent", bytes.NewReader(geminiBody))
	req.Header.Set("X-Goog-Api-Key", "lw_vk_test")
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	require.NotNil(t, gotReq, "provider was not dispatched")
	assert.Equal(t, domain.RequestTypePassthrough, gotReq.Type)
	assert.Equal(t, "gemini-2.5-flash", gotReq.Model)
	assert.Equal(t, "/models/gemini-2.5-flash:generateContent", gotReq.Passthrough.Path)
	assert.Equal(t, http.MethodPost, gotReq.Passthrough.Method)
	assert.False(t, gotReq.Passthrough.Stream)
	// Auth headers must be stripped before forwarding upstream — Bifrost
	// injects the real provider key.
	assert.NotContains(t, gotReq.Passthrough.Headers, "X-Goog-Api-Key")
	assert.NotContains(t, gotReq.Passthrough.Headers, "Authorization")

	// Upstream body + content-type passed through verbatim.
	assert.Contains(t, rec.Body.String(), "candidates")
	assert.Equal(t, "application/json; charset=UTF-8", rec.Header().Get("Content-Type"))
}

func TestRouter_GeminiPassthrough_Streaming_PicksStream(t *testing.T) {
	auth := &mockAuth{
		resolveFn: func(_ context.Context, _ string) (*domain.Bundle, error) {
			return testBundle(), nil
		},
	}

	syncCalled := false
	streamCalled := false
	var gotReq *domain.Request
	provider := &mockStreamProvider{
		mockProvider: mockProvider{
			dispatchFn: func(_ context.Context, _ *domain.Request, _ domain.Credential) (*domain.Response, error) {
				syncCalled = true
				return successResponse(), nil
			},
		},
		dispatchStreamFn: func(_ context.Context, req *domain.Request, _ domain.Credential) (domain.StreamIterator, error) {
			streamCalled = true
			gotReq = req
			return &emptyStreamIter{}, nil
		},
	}

	router := buildRouter(
		app.WithAuth(auth),
		app.WithProviders(provider),
		app.WithLogger(zap.NewNop()),
	)

	req := httptest.NewRequest(http.MethodPost,
		"/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse",
		bytes.NewReader([]byte(`{"contents":[{"role":"user","parts":[{"text":"hi"}]}]}`)))
	req.Header.Set("X-Goog-Api-Key", "lw_vk_test")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	require.False(t, syncCalled, "non-streaming Dispatch was called for :streamGenerateContent")
	require.True(t, streamCalled, "streaming DispatchStream was not called for :streamGenerateContent")
	require.NotNil(t, gotReq)
	assert.True(t, gotReq.Passthrough.Stream)
	assert.Equal(t, "alt=sse", gotReq.Passthrough.RawQuery)
}
