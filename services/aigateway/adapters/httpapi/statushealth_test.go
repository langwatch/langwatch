package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
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
// triggered by public polls, and can fail with the shape of error a dead
// control plane really produces, host and port included.
type statusPinger struct {
	calls atomic.Int64
	fail  atomic.Bool
}

func (p *statusPinger) Health(context.Context) error {
	p.calls.Add(1)
	if p.fail.Load() {
		return errors.New("dial tcp 10.0.0.1:5560: connection refused")
	}
	return nil
}

// healthyMonitor returns a monitor that is healthy because a probe really
// succeeded, not because it was just constructed.
//
// Construction seeds lastSuccess with "now" for the boot grace window, so
// a freshly built monitor reads healthy whether or not anything answered.
// Waiting for a probe to be attempted is not enough either: the verdict
// would still be sitting on that seed. This starts from a deliberately
// stale seed, asserts the monitor is unhealthy first, and then waits for
// it to flip. Only a probe that returned nil can do that, so if Health
// started failing this helper fails rather than handing out a monitor
// that is healthy for the wrong reason.
func healthyMonitor(t *testing.T) *statusprobe.Monitor {
	t.Helper()
	clock := &statusClock{t: time.Unix(1_700_000_000, 0)}
	mon := statusprobe.New(statusprobe.Options{
		Pinger:   &statusPinger{},
		Now:      clock.Now,
		Interval: time.Millisecond,
	})
	t.Cleanup(mon.Stop)

	clock.Advance(statusprobe.DefaultUnhealthyAfter + time.Minute)
	ok, _ := mon.ControlPlane()
	require.False(t, ok, "the construction-time seed must be stale before probing starts")

	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	mon.Start(ctx)
	require.Eventually(t, func() bool {
		ok, _ := mon.ControlPlane()
		return ok
	}, 2*time.Second, time.Millisecond, "a successful probe must move the verdict to healthy")
	return mon
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
	router := buildRouterWithStatus(healthyMonitor(t))

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
	router := buildRouterWithStatus(healthyMonitor(t), app.WithAuth(auth), app.WithProviders(provider))

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

// @scenario "polling the status endpoint puts no load on anything else"
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
	// A monitor whose probes really fail, so the degraded body is produced
	// downstream of an actual transport error rather than of a monitor that
	// never dialed anything: an implementation that formatted the error
	// into the detail would look clean against a monitor with no pinger.
	pinger := &statusPinger{}
	pinger.fail.Store(true)
	mon := statusprobe.New(statusprobe.Options{Pinger: pinger, Now: clock.Now, Interval: time.Millisecond})
	t.Cleanup(mon.Stop)
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	mon.Start(ctx)
	require.Eventually(t, func() bool {
		return pinger.calls.Load() >= 2
	}, 2*time.Second, time.Millisecond, "the monitor should have observed real failures")

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
		router := buildRouterWithStatus(healthyMonitor(t))
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

// @scenario "HEAD polls get the same verdict as GET"
// Over a real server rather than a recorder, because that is where the
// difference shows. net/http discards the body of a HEAD response while
// still reporting the Content-Length the GET would have carried, which is
// what RFC 9110 asks for. Guarding the encode with `r.Method == HEAD`
// looks tidier and is worse: measured against a real server it drops
// Content-Length entirely and adds `Connection: close`, so a status
// monitor polling with HEAD would pay a fresh handshake every time.
func TestHealthEndpoint_HeadOnTheWireHasNoBodyButKeepsContentLength(t *testing.T) {
	srv := httptest.NewServer(buildRouterWithStatus(healthyMonitor(t)))
	defer srv.Close()

	req, err := http.NewRequest(http.MethodHead, srv.URL+"/health", nil)
	require.NoError(t, err)
	resp, err := srv.Client().Do(req)
	require.NoError(t, err)
	defer func() { _ = resp.Body.Close() }()

	body, err := io.ReadAll(resp.Body)
	require.NoError(t, err)

	assert.Equal(t, http.StatusOK, resp.StatusCode)
	assert.Empty(t, body, "HEAD must not carry a body on the wire")
	assert.Positive(t, resp.ContentLength, "HEAD must still report the length GET would have sent")
	assert.Equal(t, "application/json", resp.Header.Get("Content-Type"))
	assert.Equal(t, "no-store", resp.Header.Get("Cache-Control"))
	assert.NotEqual(t, "close", resp.Header.Get("Connection"), "HEAD polls should reuse the connection")
}

// The chart publishes /health as an Exact ingress path, which bounds the
// path but not the method. The method guarantee lives here, so the chart
// comment that says so stays true.
func TestHealthEndpoint_RejectsOtherMethods(t *testing.T) {
	router := buildRouterWithStatus(healthyMonitor(t))

	for _, method := range []string{http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete} {
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, httptest.NewRequest(method, "/health", nil))
		assert.Equal(t, http.StatusMethodNotAllowed, rec.Code, "%s /health", method)
	}
}

// Without a reporter wired (nil Status), the endpoint answers rather than
// 404ing the monitor, but it fails closed: a gateway that cannot observe
// its control plane must not pin the public status page green.
func TestHealthEndpoint_NilReporterFailsClosed(t *testing.T) {
	router := buildRouter()

	rec, body := getHealth(t, router)
	assert.Equal(t, http.StatusServiceUnavailable, rec.Code)
	assert.Equal(t, "degraded", body.Status)
	assert.Equal(t, map[string]string{"gateway": "ok", "control_plane": "not configured"}, body.Checks)
}

func mapKeys(m map[string]any) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	return keys
}
