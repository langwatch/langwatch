package httpapi

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/health"
	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/app"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

const corsPageOrigin = "https://app.example.com"

// corsWorld counts what a request reached, so a preflight can be shown to
// stop before auth and the pipeline.
type corsWorld struct {
	authCalls     int
	dispatchCalls int
	budget        domain.BudgetVerdict
	rejectKey     bool
}

func corsRouter(t *testing.T, world *corsWorld, allowedOrigins string) http.Handler {
	t.Helper()
	origins, err := ParseCORSAllowedOrigins(allowedOrigins)
	require.NoError(t, err)
	auth := &mockAuth{resolveFn: func(ctx context.Context, _ string) (*domain.Bundle, error) {
		world.authCalls++
		if world.rejectKey {
			return nil, herr.New(ctx, domain.ErrInvalidAPIKey, herr.M{"message": "no such key"})
		}
		return testBundle(), nil
	}}
	provider := &mockProvider{dispatchFn: func(_ context.Context, _ *domain.Request, _ domain.Credential) (*domain.Response, error) {
		world.dispatchCalls++
		return successResponse(), nil
	}}
	budget := &mockBudget{precheckFn: func(_ context.Context, _ *domain.Bundle) (domain.BudgetDecision, error) {
		return domain.BudgetDecision{Verdict: world.budget}, nil
	}}
	reg := health.New("test")
	reg.MarkStarted()
	return NewRouter(RouterDeps{
		App: app.New(
			app.WithAuth(auth),
			app.WithProviders(provider),
			app.WithBudget(budget),
			app.WithLogger(zap.NewNop()),
		),
		Logger:             zap.NewNop(),
		Health:             reg,
		CORSAllowedOrigins: origins,
	})
}

func corsChat(router http.Handler, origin string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", bytes.NewReader(chatBody()))
	req.Header.Set("Authorization", "Bearer vk-lw-test")
	if origin != "" {
		req.Header.Set("Origin", origin)
	}
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

func corsPreflight(router http.Handler, path, origin string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodOptions, path, nil)
	req.Header.Set("Origin", origin)
	req.Header.Set("Access-Control-Request-Method", http.MethodPost)
	req.Header.Set("Access-Control-Request-Headers", "authorization, content-type, x-langwatch-end-user-id, x-stainless-os")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

func assertNoCORSHeaders(t *testing.T, header http.Header) {
	t.Helper()
	for name := range header {
		assert.False(t, strings.HasPrefix(name, "Access-Control-"), "unexpected header %s", name)
	}
}

// @scenario "A gateway with no allowed origins sends no CORS headers"
func TestCORS_OffByDefault(t *testing.T) {
	world := &corsWorld{}
	router := corsRouter(t, world, "")

	rec := corsChat(router, corsPageOrigin)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	assertNoCORSHeaders(t, rec.Header())
	assert.Empty(t, rec.Header().Values("Vary"))

	preflight := corsPreflight(router, "/v1/chat/completions", corsPageOrigin)
	assert.Equal(t, http.StatusMethodNotAllowed, preflight.Code)
	assertNoCORSHeaders(t, preflight.Header())
}

// @scenario "A request from an allowed origin is answered with that origin"
func TestCORS_AllowedOriginOnSuccess(t *testing.T) {
	world := &corsWorld{}
	router := corsRouter(t, world, "https://other.example.com,"+corsPageOrigin)

	rec := corsChat(router, corsPageOrigin)

	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	assert.Equal(t, corsPageOrigin, rec.Header().Get("Access-Control-Allow-Origin"))
	assert.Contains(t, rec.Header().Values("Vary"), "Origin")
	assert.Empty(t, rec.Header().Get("Access-Control-Allow-Credentials"))
	assert.Equal(t, 1, world.dispatchCalls)
}

// @scenario "A page can read the session id and the other gateway headers"
func TestCORS_ExposesGatewayHeaders(t *testing.T) {
	router := corsRouter(t, &corsWorld{}, corsPageOrigin)

	rec := corsChat(router, corsPageOrigin)

	exposed := map[string]bool{}
	for _, name := range strings.Split(rec.Header().Get("Access-Control-Expose-Headers"), ",") {
		exposed[strings.TrimSpace(name)] = true
	}
	for _, name := range []string{
		"X-LangWatch-Session-Id",
		"X-LangWatch-Gateway-Request-Id",
		"X-Request-Id",
		"Location",
		"Retry-After",
		"X-LangWatch-Budget-Warning",
		"X-LangWatch-Guardrails-Not-Applied",
	} {
		assert.True(t, exposed[name], "%s is not exposed", name)
	}
}

// @scenario "A refusal carries the CORS headers so the page can read it"
func TestCORS_AllowedOriginOnRefusals(t *testing.T) {
	t.Run("402 over budget", func(t *testing.T) {
		world := &corsWorld{budget: domain.BudgetBlock}
		rec := corsChat(corsRouter(t, world, corsPageOrigin), corsPageOrigin)

		require.Equal(t, http.StatusPaymentRequired, rec.Code, rec.Body.String())
		assert.Equal(t, corsPageOrigin, rec.Header().Get("Access-Control-Allow-Origin"))
		assert.NotEmpty(t, rec.Header().Get("Access-Control-Expose-Headers"))
	})

	t.Run("401 invalid key", func(t *testing.T) {
		world := &corsWorld{rejectKey: true}
		rec := corsChat(corsRouter(t, world, corsPageOrigin), corsPageOrigin)

		require.Equal(t, http.StatusUnauthorized, rec.Code, rec.Body.String())
		assert.Equal(t, corsPageOrigin, rec.Header().Get("Access-Control-Allow-Origin"))
	})

	t.Run("401 no key", func(t *testing.T) {
		router := corsRouter(t, &corsWorld{}, corsPageOrigin)
		req := httptest.NewRequest(http.MethodPost, "/v1/live/sessions", nil)
		req.Header.Set("Origin", corsPageOrigin)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		require.Equal(t, http.StatusUnauthorized, rec.Code, rec.Body.String())
		assert.Equal(t, corsPageOrigin, rec.Header().Get("Access-Control-Allow-Origin"))
	})
}

// @scenario "A preflight is answered without a key and without running the request"
func TestCORS_PreflightSkipsAuth(t *testing.T) {
	world := &corsWorld{}
	router := corsRouter(t, world, corsPageOrigin)

	for _, path := range []string{
		"/v1/live/sessions",
		"/v1/realtime/calls",
		"/v1/realtime/client_secrets",
		"/v1/single-use-token/realtime_scribe",
		"/v1/realtime/sessions/sess_1/usage",
		"/v1/audio/speech",
	} {
		t.Run(path, func(t *testing.T) {
			rec := corsPreflight(router, path, corsPageOrigin)

			require.Equal(t, http.StatusNoContent, rec.Code)
			assert.Empty(t, rec.Body.String())
			h := rec.Header()
			assert.Equal(t, corsPageOrigin, h.Get("Access-Control-Allow-Origin"))
			assert.Equal(t, "GET, POST, PUT, OPTIONS", h.Get("Access-Control-Allow-Methods"))
			assert.Equal(t,
				"authorization, content-type, x-langwatch-end-user-id, x-stainless-os",
				h.Get("Access-Control-Allow-Headers"))
			assert.Equal(t, "600", h.Get("Access-Control-Max-Age"))
			assert.Empty(t, h.Get("Access-Control-Allow-Credentials"))
			assert.Contains(t, h.Values("Vary"), "Origin")
		})
	}
	assert.Zero(t, world.authCalls, "a preflight carries no key and must not reach auth")
	assert.Zero(t, world.dispatchCalls)
}

// @scenario "A request from an origin that is not allowed gets no CORS headers"
func TestCORS_DisallowedOrigin(t *testing.T) {
	world := &corsWorld{}
	router := corsRouter(t, world, corsPageOrigin)

	rec := corsChat(router, "https://evil.example.com")
	require.Equal(t, http.StatusOK, rec.Code, "the request is served as it is with CORS off")
	assertNoCORSHeaders(t, rec.Header())
	assert.Contains(t, rec.Header().Values("Vary"), "Origin")

	preflight := corsPreflight(router, "/v1/chat/completions", "https://evil.example.com")
	assert.Equal(t, http.StatusMethodNotAllowed, preflight.Code)
	assertNoCORSHeaders(t, preflight.Header())
}

// @scenario "A gateway that allows every origin answers with a wildcard"
func TestCORS_AnyOrigin(t *testing.T) {
	router := corsRouter(t, &corsWorld{}, "*")

	rec := corsChat(router, "https://anything.example.org")
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	assert.Equal(t, "*", rec.Header().Get("Access-Control-Allow-Origin"))
	assert.Empty(t, rec.Header().Get("Access-Control-Allow-Credentials"))

	preflight := corsPreflight(router, "/v1/live/sessions", "http://localhost:5173")
	assert.Equal(t, http.StatusNoContent, preflight.Code)
	assert.Equal(t, "*", preflight.Header().Get("Access-Control-Allow-Origin"))
}

// @scenario "Routes outside /v1 never send CORS headers"
func TestCORS_OnlyOnPublicV1(t *testing.T) {
	router := corsRouter(t, &corsWorld{}, "*")

	for _, path := range []string{"/healthz", "/health", "/debug/control-plane"} {
		t.Run(path, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, path, nil)
			req.Header.Set("Origin", corsPageOrigin)
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, req)
			assertNoCORSHeaders(t, rec.Header())
		})
	}
}

// @scenario "A WebSocket handshake is left untouched"
func TestCORS_LeavesWebSocketUpgradesAlone(t *testing.T) {
	called := false
	handler := CORSMiddleware([]string{corsPageOrigin})(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		called = true
		w.WriteHeader(http.StatusSwitchingProtocols)
	}))
	req := httptest.NewRequest(http.MethodGet, "/v1/realtime", nil)
	req.Header.Set("Origin", corsPageOrigin)
	req.Header.Set("Upgrade", "websocket")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	assert.True(t, called)
	assertNoCORSHeaders(t, rec.Header())
	assert.Empty(t, rec.Header().Values("Vary"))
}
