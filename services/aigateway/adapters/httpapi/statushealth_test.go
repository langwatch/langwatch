package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/health"
	"github.com/langwatch/langwatch/services/aigateway/adapters/statusprobe"
	"github.com/langwatch/langwatch/services/aigateway/app"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// statusClock mirrors the statusprobe test clock: verdict windows are
// exercised by moving time, not by sleeping.
type statusClock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *statusClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.t
}

func (c *statusClock) Advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.t = c.t.Add(d)
}

// statusPinger counts control-plane probes so tests can prove none were
// triggered by public polls.
type statusPinger struct {
	calls atomic.Int64
}

func (p *statusPinger) Health(context.Context) error {
	p.calls.Add(1)
	return nil
}

func buildRouterWithStatus(status StatusReporter, opts ...app.Option) http.Handler {
	reg := health.New("test")
	reg.MarkStarted()
	return NewRouter(RouterDeps{
		App:    app.New(opts...),
		Logger: zap.NewNop(),
		Health: reg,
		Status: status,
	})
}

func getHealth(t *testing.T, router http.Handler) (*httptest.ResponseRecorder, statusBody) {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	var body statusBody
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&body))
	return rec, body
}

type statusBody struct {
	Status string            `json:"status"`
	Checks map[string]string `json:"checks"`
}

// @scenario "healthy gateway reports ok with a component breakdown"
func TestHealthEndpoint_HealthyReportsComponents(t *testing.T) {
	// A real monitor, fresh from construction: last successful contact is
	// "now", which is exactly the state after a recent successful probe.
	mon := statusprobe.New(statusprobe.Options{})
	router := buildRouterWithStatus(mon)

	rec, body := getHealth(t, router)

	assert.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, "application/json", rec.Header().Get("Content-Type"))
	assert.Equal(t, "no-store", rec.Header().Get("Cache-Control"))
	assert.Equal(t, "ok", body.Status)
	assert.Equal(t, "ok", body.Checks["gateway"])
	assert.Equal(t, "ok", body.Checks["control_plane"])
}

// @scenario "a total model provider outage never turns gateway health red"
// The guarantee the status page depends on: with every provider dispatch
// failing (OpenAI and Anthropic both down, as far as the gateway can
// tell), completions return 5xx while /health stays 200. Third-party
// outage is their status, not ours.
func TestHealthEndpoint_ProviderOutageStays200(t *testing.T) {
	auth := &mockAuth{
		resolveFn: func(_ context.Context, _ string) (*domain.Bundle, error) {
			return testBundle(), nil
		},
	}
	provider := &mockProvider{
		dispatchFn: func(_ context.Context, _ *domain.Request, _ domain.Credential) (*domain.Response, error) {
			return nil, &domain.UpstreamError{
				StatusCode: http.StatusInternalServerError,
				Message:    "upstream provider is melting down",
			}
		},
	}
	mon := statusprobe.New(statusprobe.Options{})
	router := buildRouterWithStatus(mon, app.WithAuth(auth), app.WithProviders(provider))

	// The provider outage is user-visible on the dispatch path...
	for range 3 {
		req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", bytes.NewReader(chatBody()))
		req.Header.Set("Authorization", "Bearer vk-lw-test")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		require.GreaterOrEqual(t, rec.Code, 500, "dispatch should be failing in this simulation")
	}

	// ...and invisible to the status verdict.
	rec, body := getHealth(t, router)
	assert.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, "ok", body.Status)
	assert.Equal(t, "ok", body.Checks["control_plane"])
}

// @scenario "status polls never fan out to providers or the control plane"
// The monitor is built but never started: its ticker is the only thing
// allowed to probe, so with no ticker running, any probe observed here
// would have been triggered by a public poll, an amplification bug.
func TestHealthEndpoint_PollsDoNotFanOut(t *testing.T) {
	pinger := &statusPinger{}
	mon := statusprobe.New(statusprobe.Options{Pinger: pinger})

	var dispatches atomic.Int64
	provider := &mockProvider{
		dispatchFn: func(_ context.Context, _ *domain.Request, _ domain.Credential) (*domain.Response, error) {
			dispatches.Add(1)
			return successResponse(), nil
		},
	}
	router := buildRouterWithStatus(mon, app.WithProviders(provider))

	for range 50 {
		rec, body := getHealth(t, router)
		require.Equal(t, http.StatusOK, rec.Code)
		require.Equal(t, "ok", body.Status)
	}

	assert.Zero(t, pinger.calls.Load(), "a /health poll must never probe the control plane")
	assert.Zero(t, dispatches.Load(), "a /health poll must never dispatch to a provider")
}

// @scenario "sustained control plane outage flips health to 503"
func TestHealthEndpoint_ControlPlaneOutageFlips503(t *testing.T) {
	clock := &statusClock{t: time.Unix(1_700_000_000, 0)}
	mon := statusprobe.New(statusprobe.Options{Now: clock.Now})
	router := buildRouterWithStatus(mon)

	clock.Advance(statusprobe.DefaultUnhealthyAfter + 33*time.Second)

	rec, body := getHealth(t, router)
	assert.Equal(t, http.StatusServiceUnavailable, rec.Code)
	assert.Equal(t, "degraded", body.Status)
	assert.Equal(t, "ok", body.Checks["gateway"], "the process itself is still up")
	assert.Contains(t, body.Checks["control_plane"], "unreachable")
}

// @scenario "health response carries no tenant data or internal endpoints"
// Asserted in both verdicts, since the degraded detail string is the only
// dynamic content and the most likely place for an error string carrying
// the control plane's URL to leak.
func TestHealthEndpoint_BodyIsPublicSafe(t *testing.T) {
	clock := &statusClock{t: time.Unix(1_700_000_000, 0)}
	mon := statusprobe.New(statusprobe.Options{Now: clock.Now})
	router := buildRouterWithStatus(mon)

	assertPublicSafe := func(t *testing.T) {
		t.Helper()
		req := httptest.NewRequest(http.MethodGet, "/health", nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		raw := rec.Body.String()

		var generic map[string]any
		require.NoError(t, json.Unmarshal([]byte(raw), &generic))
		assert.ElementsMatch(t, []string{"status", "checks"}, mapKeys(generic), "body must stay minimal")

		checks, ok := generic["checks"].(map[string]any)
		require.True(t, ok)
		assert.Subset(t, []string{"gateway", "control_plane"}, mapKeys(checks))

		for _, needle := range []string{"http://", "https://", "localhost", "5560", "vk-", "proj", "org", "team"} {
			assert.NotContains(t, raw, needle)
		}
		assert.NotRegexp(t, `[a-z0-9-]+\.[a-z]{2,}`, raw, "no hostname-shaped token in the public body")
	}

	assertPublicSafe(t)
	clock.Advance(statusprobe.DefaultUnhealthyAfter + time.Hour)
	assertPublicSafe(t)
}

// @scenario "HEAD polls get the same verdict as GET"
func TestHealthEndpoint_HeadMatchesGet(t *testing.T) {
	t.Run("healthy", func(t *testing.T) {
		mon := statusprobe.New(statusprobe.Options{})
		router := buildRouterWithStatus(mon)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, httptest.NewRequest(http.MethodHead, "/health", nil))
		assert.Equal(t, http.StatusOK, rec.Code)
	})

	t.Run("degraded", func(t *testing.T) {
		clock := &statusClock{t: time.Unix(1_700_000_000, 0)}
		mon := statusprobe.New(statusprobe.Options{Now: clock.Now})
		clock.Advance(statusprobe.DefaultUnhealthyAfter + time.Minute)
		router := buildRouterWithStatus(mon)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, httptest.NewRequest(http.MethodHead, "/health", nil))
		assert.Equal(t, http.StatusServiceUnavailable, rec.Code)
	})
}

// Without a reporter wired (nil Status), the endpoint still answers with
// the process-level component so a partially wired deployment fails open
// rather than 404ing the monitor.
func TestHealthEndpoint_NilReporterServesProcessComponent(t *testing.T) {
	router := buildRouter()

	rec, body := getHealth(t, router)
	assert.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, "ok", body.Status)
	assert.Equal(t, map[string]string{"gateway": "ok"}, body.Checks)
}

func mapKeys(m map[string]any) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	return keys
}
