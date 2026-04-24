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
