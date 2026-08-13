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

	"github.com/langwatch/langwatch/pkg/breaker"
	"github.com/langwatch/langwatch/pkg/health"
	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/adapters/gatewaymetrics"
	"github.com/langwatch/langwatch/services/aigateway/adapters/modelresolver"
	"github.com/langwatch/langwatch/services/aigateway/app"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// buildRouterWithMetrics wires a router against a real recorder so the
// assertions below go through the same middleware stack production uses.
func buildRouterWithMetrics(rec *gatewaymetrics.Recorder, opts ...app.Option) http.Handler {
	reg := health.New("test")
	reg.MarkStarted()
	return NewRouter(RouterDeps{
		App:     app.New(opts...),
		Logger:  zap.NewNop(),
		Health:  reg,
		Metrics: rec,
	})
}

func scrapeRouter(t *testing.T, router http.Handler) string {
	t.Helper()
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/metrics", nil))
	require.Equal(t, http.StatusOK, rec.Code)
	return rec.Body.String()
}

// gatewaySeries narrows a scrape to this service's own sample lines, so a
// failed assertion prints those instead of several hundred lines of Go
// runtime metrics.
func gatewaySeries(t *testing.T, router http.Handler) string {
	t.Helper()
	var kept []string
	for _, line := range strings.Split(scrapeRouter(t, router), "\n") {
		if strings.HasPrefix(line, "gateway_") {
			kept = append(kept, line)
		}
	}
	return strings.Join(kept, "\n")
}

func TestRouter_MetricsEndpointNeedsNoCredential(t *testing.T) {
	// The cluster's scraper has no virtual key. If /metrics sat behind
	// auth, a self-hoster following the docs would get a 401 with nothing
	// explaining why.
	body := scrapeRouter(t, buildRouterWithMetrics(gatewaymetrics.New()))

	assert.Contains(t, body, "gateway_draining")
	assert.Contains(t, body, "go_goroutines")
	// The scrape must not count itself: an endpoint the cluster hits every
	// fifteen seconds would dominate the request counter and dilute the
	// error-rate ratio the documented alert divides on.
	assert.NotContains(t, body, `route="/metrics"`)
	assert.Contains(t, body, "gateway_in_flight_requests 0")
}

func TestRouter_MetricsNotMountedWithoutRecorder(t *testing.T) {
	rec := httptest.NewRecorder()
	buildRouter().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/metrics", nil))

	assert.Equal(t, http.StatusNotFound, rec.Code)
}

func TestRouter_CompletedRequestMovesTheCounters(t *testing.T) {
	recorder := gatewaymetrics.New()
	auth := &mockAuth{resolveFn: func(context.Context, string) (*domain.Bundle, error) {
		return testBundle(), nil
	}}
	provider := &mockProvider{dispatchFn: func(context.Context, *domain.Request, domain.Credential) (*domain.Response, error) {
		return successResponse(), nil
	}}

	router := buildRouterWithMetrics(recorder,
		app.WithAuth(auth),
		app.WithProviders(provider),
		app.WithModels(modelresolver.New()),
		app.WithMetrics(recorder),
		app.WithCircuitBreaker(breaker.NewRegistry(breaker.Options{})),
	)

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", bytes.NewReader(chatBody()))
	req.Header.Set("Authorization", "Bearer sk-test")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	require.Equal(t, http.StatusOK, rec.Code)

	body := gatewaySeries(t, router)

	// A metric that exists but never moves is barely better than a missing
	// one, so assert on the recorded series rather than just the name.
	assert.Contains(t, body, `gateway_http_requests_total{model="gpt-4",provider="openai",route="/v1/chat/completions",status="200"} 1`)
	assert.Contains(t, body, `gateway_provider_attempts_total{credential_id="cred-1",outcome="success"} 1`)
	assert.Contains(t, body, `gateway_circuit_state{credential_id="cred-1"}`)
	assert.Contains(t, body, `gateway_cache_hits_total{outcome="miss"} 1`)
	assert.Contains(t, body, `gateway_http_request_duration_seconds_count{provider="openai",route="/v1/chat/completions"} 1`)
	assert.Contains(t, body, `gateway_provider_duration_seconds_count{model="gpt-4",provider="openai"} 1`)
	assert.Contains(t, body, "gateway_in_flight_requests 0")
}

func TestRouter_RejectedRequestIsStillCounted(t *testing.T) {
	recorder := gatewaymetrics.New()
	auth := &mockAuth{resolveFn: func(context.Context, string) (*domain.Bundle, error) {
		return testBundle(), nil
	}}

	router := buildRouterWithMetrics(recorder,
		app.WithAuth(auth),
		app.WithMetrics(recorder),
	)

	// No Authorization header, so the request is rejected in middleware,
	// before anything resolves a provider or a model.
	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", bytes.NewReader(chatBody()))
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	require.Equal(t, http.StatusUnauthorized, rec.Code)

	// Rejected before model resolution, so provider and model are genuinely
	// unknown, but the request still has to show up on the error rate.
	// The route folds onto the mounted pattern rather than the leaf: chi
	// has not matched a leaf route yet when the auth middleware rejects.
	// That is the right answer for cardinality, and the request still
	// lands on the error rate.
	assert.Contains(t, gatewaySeries(t, router),
		`gateway_http_requests_total{model="unknown",provider="unknown",route="/v1/*",status="401"} 1`)
}

// @scenario "A customer-fault rejection is counted against the key that sent it"
func TestRouter_ClientRejectsCannotBeMintedByAnUnauthenticatedCaller(t *testing.T) {
	// gateway_client_rejects_total carries a per-virtual-key label, which is
	// only bounded if every value is control-plane-minted. AuthMiddleware
	// answers a missing or unresolvable key with herr.WriteHTTP directly
	// rather than through writeError, so an unauthenticated caller never
	// reaches the choke point that records this counter at all. Asserted by
	// driving the real middleware stack, because the claim is about ordering
	// and reading the code is not proof of it.
	t.Run("when the caller sends no API key", func(t *testing.T) {
		recorder := gatewaymetrics.New()
		router := buildRouterWithMetrics(recorder,
			app.WithAuth(&mockAuth{resolveFn: func(context.Context, string) (*domain.Bundle, error) {
				return testBundle(), nil
			}}),
			app.WithMetrics(recorder),
		)

		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/v1/chat/completions", bytes.NewReader(chatBody())))
		require.Equal(t, http.StatusUnauthorized, rec.Code)

		assert.NotContains(t, gatewaySeries(t, router), "gateway_client_rejects_total")
	})

	t.Run("when the caller sends a key the control plane rejects", func(t *testing.T) {
		recorder := gatewaymetrics.New()
		router := buildRouterWithMetrics(recorder,
			app.WithAuth(&mockAuth{resolveFn: func(ctx context.Context, _ string) (*domain.Bundle, error) {
				return nil, herr.New(ctx, domain.ErrInvalidAPIKey, herr.M{"message": "no such key"})
			}}),
			app.WithMetrics(recorder),
		)

		req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", bytes.NewReader(chatBody()))
		// The caller controls this string completely. If it could reach a
		// label, one client looping over random tokens would mint a series
		// each and take the pod down.
		req.Header.Set("Authorization", "Bearer "+strings.Repeat("z", 64))
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		require.Equal(t, http.StatusUnauthorized, rec.Code)

		series := gatewaySeries(t, router)
		assert.NotContains(t, series, "gateway_client_rejects_total")
		assert.NotContains(t, series, "zzzz")
	})

	// The counterpart: a request that DID authenticate and is then rejected
	// on its body is counted, against the key the control plane minted.
	t.Run("when an authenticated caller sends a body with no model", func(t *testing.T) {
		recorder := gatewaymetrics.New()
		router := buildRouterWithMetrics(recorder,
			app.WithAuth(&mockAuth{resolveFn: func(context.Context, string) (*domain.Bundle, error) {
				return testBundle(), nil
			}}),
			app.WithModels(modelresolver.New()),
			app.WithMetrics(recorder),
		)

		req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions",
			bytes.NewReader([]byte(`{"messages":[{"role":"user","content":"hi"}]}`)))
		req.Header.Set("Authorization", "Bearer sk-test")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		require.Equal(t, http.StatusBadRequest, rec.Code)
		assert.Equal(t, "missing_model", rec.Header().Get(herr.HandledErrorHeader))

		assert.Contains(t, gatewaySeries(t, router),
			`gateway_client_rejects_total{code="missing_model",vk_id="vk-test"} 1`)
	})
}
