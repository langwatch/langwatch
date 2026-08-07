package gatewaymetrics

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/prometheus/client_golang/prometheus/testutil"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

func TestRecorder_NilIsSafe(t *testing.T) {
	var r *Recorder

	assert.NotPanics(t, func() {
		r.ObserveHTTPRequest("/v1/chat/completions", 200, "openai", "gpt-5-mini", 0.1)
		r.RecordProviderAttempt("cred_1", "success", "openai", "gpt-5-mini", 0.1)
		r.RecordFallback("cred_1", "cred_2")
		r.SetCircuitState("cred_1", 1)
		r.RecordAuthCacheLookup()
		r.RecordAuthCacheHit(TierL1)
		r.RecordAuthCacheMiss(TierL1)
		r.RecordBudgetBlock("organization")
		r.RecordCacheOutcome(domain.Usage{})
		r.RecordCacheRuleHit("rule_1", "force")
		r.RecordGuardrailVerdict(DirectionRequest, VerdictBlock)
		r.RecordControlPlaneCall("resolve-key", "200", 0.01)
		r.RecordRateLimitDenied("rpm", "vk_1")
		r.RecordClientReject("bad_request", "vk_1")
		r.StreamOpened()
		r.StreamClosed("openai", "gpt-5-mini", domain.Usage{})
		r.TrackDraining(func() bool { return true })
		r.TrackAuthCacheSize(func() int { return 1 })
		r.TrackSpendSpool(func() SpoolStats { return SpoolStats{} })
	})
	assert.Nil(t, r.Registry())
	assert.Nil(t, r.DeclaredMetrics())
}

func TestRecorder_ObserveHTTPRequest(t *testing.T) {
	r := New()

	r.ObserveHTTPRequest("/v1/chat/completions", 200, "openai", "gpt-5-mini", 0.25)
	r.ObserveHTTPRequest("/v1/chat/completions", 429, "openai", "gpt-5-mini", 0.01)

	assert.Equal(t, 1.0, testutil.ToFloat64(r.httpRequests.WithLabelValues("/v1/chat/completions", "200", "openai", "gpt-5-mini")))
	assert.Equal(t, 1.0, testutil.ToFloat64(r.httpRequests.WithLabelValues("/v1/chat/completions", "429", "openai", "gpt-5-mini")))
	// Latency is keyed by route and provider only: status and model would
	// multiply the bucket count for no operational gain.
	assert.Equal(t, 1, testutil.CollectAndCount(r.httpDuration))
}

func TestRecorder_EmptyLabelsFoldToPlaceholder(t *testing.T) {
	r := New()

	// A request rejected before model resolution has neither provider nor
	// model. Empty strings would still mint a series, just an unreadable
	// one, so they collapse onto a named placeholder instead.
	r.ObserveHTTPRequest("", 401, "", "", 0.001)

	assert.Equal(t, 1.0, testutil.ToFloat64(r.httpRequests.WithLabelValues("unknown", "401", "unknown", "unknown")))
}

func TestRecorder_ProviderAttempts(t *testing.T) {
	r := New()

	r.RecordProviderAttempt("cred_1", "retryable_5xx", "openai", "gpt-5-mini", 1.5)
	r.RecordProviderAttempt("cred_2", "fallback_success", "anthropic", "claude", 0.5)
	// An attempt the circuit skipped never reached a provider, so it is
	// counted but must not pollute the upstream latency histogram.
	r.RecordProviderAttempt("cred_3", "circuit_open", "openai", "gpt-5-mini", 0)

	assert.Equal(t, 1.0, testutil.ToFloat64(r.providerTries.WithLabelValues("cred_1", "retryable_5xx")))
	assert.Equal(t, 1.0, testutil.ToFloat64(r.providerTries.WithLabelValues("cred_2", "fallback_success")))
	assert.Equal(t, 1.0, testutil.ToFloat64(r.providerTries.WithLabelValues("cred_3", "circuit_open")))
	assert.Equal(t, 2, testutil.CollectAndCount(r.providerTime), "the skipped attempt must not be timed")
}

func TestRecorder_FallbackAndCircuitState(t *testing.T) {
	r := New()

	r.RecordFallback("cred_1", "cred_2")
	r.SetCircuitState("cred_1", 1)
	r.SetCircuitState("cred_1", 0)
	r.SetCircuitState("", 2)

	assert.Equal(t, 1.0, testutil.ToFloat64(r.fallbackEvents.WithLabelValues("cred_1", "cred_2")))
	assert.Equal(t, 0.0, testutil.ToFloat64(r.circuitState.WithLabelValues("cred_1")), "state is replaced, not accumulated")
	assert.Equal(t, 1, testutil.CollectAndCount(r.circuitState), "an empty credential id must not create a series")
}

func TestRecorder_AuthCache(t *testing.T) {
	r := New()

	r.RecordAuthCacheLookup()
	r.RecordAuthCacheLookup()
	r.RecordAuthCacheHit(TierL1)
	r.RecordAuthCacheMiss(TierL1)
	r.RecordAuthCacheMiss(TierL2Redis)

	assert.Equal(t, 2.0, testutil.ToFloat64(r.authLookups))
	assert.Equal(t, 1.0, testutil.ToFloat64(r.authHits.WithLabelValues(TierL1)))
	assert.Equal(t, 1.0, testutil.ToFloat64(r.authMisses.WithLabelValues(TierL1)))
	assert.Equal(t, 1.0, testutil.ToFloat64(r.authMisses.WithLabelValues(TierL2Redis)))
}

func TestRecorder_CacheOutcomeReadsProviderUsage(t *testing.T) {
	r := New()

	r.RecordCacheOutcome(domain.Usage{PromptTokens: 100, CacheReadTokens: 80})
	r.RecordCacheOutcome(domain.Usage{PromptTokens: 100})

	assert.Equal(t, 1.0, testutil.ToFloat64(r.cacheHits.WithLabelValues(CacheOutcomeHit)))
	assert.Equal(t, 1.0, testutil.ToFloat64(r.cacheHits.WithLabelValues(CacheOutcomeMiss)))
}

func TestRecorder_CacheRuleModeIsUpperCased(t *testing.T) {
	r := New()

	// The domain enum is lower-case but the control plane's mode enum is
	// upper-case on the wire, precisely so operators can filter on it.
	r.RecordCacheRuleHit("rule_1", string(domain.CacheActionForce))

	assert.Equal(t, 1.0, testutil.ToFloat64(r.cacheRuleHits.WithLabelValues("rule_1", "FORCE")))
}

func TestRecorder_BudgetAndRateLimit(t *testing.T) {
	r := New()

	r.RecordBudgetBlock("organization")
	r.RecordRateLimitDenied("rpm", "vk_1")
	r.RecordRateLimitDenied("rpd", "vk_1")

	assert.Equal(t, 1.0, testutil.ToFloat64(r.budgetBlocks.WithLabelValues("organization")))
	assert.Equal(t, 1.0, testutil.ToFloat64(r.rateLimits.WithLabelValues("rpm", "vk_1")))
	assert.Equal(t, 1.0, testutil.ToFloat64(r.rateLimits.WithLabelValues("rpd", "vk_1")))
}

// @scenario "A customer-fault rejection is counted against the key that sent it"
func TestRecorder_ClientRejects(t *testing.T) {
	r := New()

	tests := []struct {
		name  string
		code  string
		vkID  string
		times int
		want  float64
	}{
		{"a key looping on a malformed body", "bad_request", "vk_flooder", 3, 3},
		{"the same key failing a different way", "model_not_allowed", "vk_flooder", 1, 1},
		{"another key entirely", "bad_request", "vk_quiet", 1, 1},
		// Belt and braces only: the gateway rejects an unauthenticated
		// request before the choke point that records this counter, so a
		// recorded reject always has a key. The placeholder is what keeps
		// that guarantee cheap if a future caller records without one.
		{"a reject recorded without a key", "bad_request", "", 1, 1},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			for range tt.times {
				r.RecordClientReject(tt.code, tt.vkID)
			}
			vkID := tt.vkID
			if vkID == "" {
				// The placeholder is a fixed constant, never the caller's
				// input, so even a keyless reject folds onto one series
				// rather than minting one.
				vkID = unknownLabel
			}
			assert.Equal(t, tt.want, testutil.ToFloat64(r.clientRejects.WithLabelValues(tt.code, vkID)))
		})
	}

	assert.Equal(t, 4, testutil.CollectAndCount(r.clientRejects))
}

// @scenario "A customer-fault rejection is counted against the key that sent it"
func TestRecorder_ClientRejectsCarryNoProjectOrModelLabel(t *testing.T) {
	// The counter exists because gateway_http_requests_total is blind to the
	// tenant, and it stays affordable only while its label set does not grow.
	// Project is redundant with the key, and model is caller-controlled.
	for _, m := range New().DeclaredMetrics() {
		if m.Name != "gateway_client_rejects_total" {
			continue
		}
		assert.ElementsMatch(t, []string{"code", "vk_id"}, m.Labels)
		return
	}
	t.Fatal("gateway_client_rejects_total is not registered")
}

func TestRecorder_GaugeSourcesDefaultToZeroUntilAttached(t *testing.T) {
	r := New()

	// The metric has to exist from process start: an operator alerting on
	// gateway_draining must not depend on a constructor being remembered.
	body := scrape(t, r)
	assert.Contains(t, body, "gateway_draining 0")
	assert.Contains(t, body, `gateway_auth_cache_size{tier="l1"} 0`)

	draining := false
	r.TrackDraining(func() bool { return draining })
	r.TrackAuthCacheSize(func() int { return 42 })
	draining = true

	body = scrape(t, r)
	assert.Contains(t, body, "gateway_draining 1")
	assert.Contains(t, body, `gateway_auth_cache_size{tier="l1"} 42`)
}

func TestRecorder_SpendSpoolCountersDefaultToZeroUntilAttached(t *testing.T) {
	r := New()

	// A pod whose spool failed to open serves without spend emission. Its
	// drop counters have to read zero rather than vanish: an alert on a
	// missing series cannot tell that pod apart from a broken scrape.
	body := scrape(t, r)
	assert.Contains(t, body, "gateway_spend_spool_appended_total 0")
	assert.Contains(t, body, `gateway_spend_spool_dropped_total{reason="intake"} 0`)
	assert.Contains(t, body, `gateway_spend_spool_dropped_total{reason="overflow"} 0`)

	stats := SpoolStats{Appended: 120, DroppedIntake: 3, DroppedOverflow: 7}
	r.TrackSpendSpool(func() SpoolStats { return stats })

	body = scrape(t, r)
	assert.Contains(t, body, "gateway_spend_spool_appended_total 120")
	assert.Contains(t, body, `gateway_spend_spool_dropped_total{reason="intake"} 3`)
	assert.Contains(t, body, `gateway_spend_spool_dropped_total{reason="overflow"} 7`)

	// Read at scrape time, not at wiring time.
	stats.DroppedOverflow = 8
	assert.Contains(t, scrape(t, r), `gateway_spend_spool_dropped_total{reason="overflow"} 8`)
}

func TestRecorder_HandlerServesRuntimeMetrics(t *testing.T) {
	body := scrape(t, New())

	assert.Contains(t, body, "go_goroutines", "the standard on-call toolkit expects runtime metrics on the same scrape")
	assert.Contains(t, body, "gateway_in_flight_requests")
}

func TestModelLabel_KeepsRealNamesWithinBudget(t *testing.T) {
	r := New()
	config := domain.BundleConfig{
		ModelAliases:  map[string]domain.ModelAlias{"fast": {Model: "gpt-5-mini"}},
		AllowedModels: []string{"claude-haiku-4-5"},
	}

	assert.Equal(t, "gpt-5-mini", r.ModelLabel(config, "gpt-5-mini"), "an alias target is control-plane owned")
	assert.Equal(t, "claude-haiku-4-5", r.ModelLabel(config, "claude-haiku-4-5"), "an allowlisted model is control-plane owned")
	// A key that permits any model is the common case, so the real name
	// still has to survive or the documented model label is worthless.
	assert.Equal(t, "gemini-3-flash", r.ModelLabel(domain.BundleConfig{}, "gemini-3-flash"))
	assert.Equal(t, "unknown", r.ModelLabel(config, ""))
}

func TestModelLabel_CapsCallerSuppliedNames(t *testing.T) {
	r := New()
	open := domain.BundleConfig{}

	for i := range modelLabelBudget {
		require.Equal(t, fmt.Sprintf("model-%d", i), r.ModelLabel(open, fmt.Sprintf("model-%d", i)))
	}

	// Past the budget a caller looping over random names can no longer
	// mint a series per name, but names already seen keep reporting.
	assert.Equal(t, "other", r.ModelLabel(open, "one-too-many"))
	assert.Equal(t, "model-0", r.ModelLabel(open, "model-0"))
	// A control-plane-vouched name is never subject to the budget.
	assert.Equal(t, "gpt-5-mini", r.ModelLabel(
		domain.BundleConfig{AllowedModels: []string{"gpt-5-mini"}}, "gpt-5-mini"))
}

func TestModelLabel_NilRecorder(t *testing.T) {
	var r *Recorder
	assert.Equal(t, "unknown", r.ModelLabel(domain.BundleConfig{}, "gpt-5-mini"))
}

func TestVerdictLabel(t *testing.T) {
	assert.Equal(t, VerdictAllow, VerdictLabel(domain.GuardrailAllow))
	assert.Equal(t, VerdictBlock, VerdictLabel(domain.GuardrailBlock))
	assert.Equal(t, VerdictModify, VerdictLabel(domain.GuardrailModify))
}

// stubGuardrails returns a fixed verdict and error for every direction.
type stubGuardrails struct {
	verdict domain.GuardrailVerdict
	err     error
}

func (s stubGuardrails) EvaluatePre(context.Context, *domain.Bundle, *domain.Request) (domain.GuardrailVerdict, error) {
	return s.verdict, s.err
}

func (s stubGuardrails) EvaluatePost(context.Context, *domain.Bundle, *domain.Request, *domain.Response) (domain.GuardrailVerdict, error) {
	return s.verdict, s.err
}

func (s stubGuardrails) EvaluateChunk(context.Context, *domain.Bundle, *domain.Request, []byte) (domain.GuardrailVerdict, error) {
	return s.verdict, s.err
}

func TestGuardrailCounter_CountsVerdictPerDirection(t *testing.T) {
	r := New()
	g := WithGuardrailMetrics(stubGuardrails{verdict: domain.GuardrailVerdict{Action: domain.GuardrailBlock}}, r)

	_, err := g.EvaluatePre(context.Background(), &domain.Bundle{}, &domain.Request{})
	require.NoError(t, err)
	_, err = g.EvaluatePost(context.Background(), &domain.Bundle{}, &domain.Request{}, &domain.Response{})
	require.NoError(t, err)
	_, err = g.EvaluateChunk(context.Background(), &domain.Bundle{}, &domain.Request{}, nil)
	require.NoError(t, err)

	assert.Equal(t, 1.0, testutil.ToFloat64(r.guardrails.WithLabelValues(DirectionRequest, VerdictBlock)))
	assert.Equal(t, 1.0, testutil.ToFloat64(r.guardrails.WithLabelValues(DirectionResponse, VerdictBlock)))
	assert.Equal(t, 1.0, testutil.ToFloat64(r.guardrails.WithLabelValues(DirectionStreamChunk, VerdictBlock)))
}

func TestGuardrailCounter_UnreachableGuardrailCountsAsFailOpen(t *testing.T) {
	r := New()
	// The evaluator returns a permissive verdict alongside the error, and
	// the pipeline lets the request through. Counting that as a plain
	// allow would hide an outage behind healthy-looking traffic.
	g := WithGuardrailMetrics(stubGuardrails{
		verdict: domain.GuardrailVerdict{Action: domain.GuardrailAllow},
		err:     errors.New("control plane unreachable"),
	}, r)

	_, err := g.EvaluatePre(context.Background(), &domain.Bundle{}, &domain.Request{})
	require.Error(t, err)

	assert.Equal(t, 1.0, testutil.ToFloat64(r.guardrails.WithLabelValues(DirectionRequest, VerdictFailOpen)))
	assert.Equal(t, 0.0, testutil.ToFloat64(r.guardrails.WithLabelValues(DirectionRequest, VerdictAllow)))
}

// The stream-chunk direction swallows its own error on purpose, so a slow
// policy service never stalls a stream a user is already reading. It returns
// an allow with no error, and before the verdict carried FailedOpen that was
// indistinguishable from a guardrail that actually passed the chunk.
func TestGuardrailCounter_StreamChunkFailOpenCountsAsFailOpenNotAllow(t *testing.T) {
	r := New()
	g := WithGuardrailMetrics(stubGuardrails{
		verdict: domain.GuardrailVerdict{
			Action:         domain.GuardrailAllow,
			FailedOpen:     true,
			FailOpenReason: "guardrail check: control plane unreachable",
		},
	}, r)

	// No error surfaces: the stream proceeds, which is the required behavior.
	verdict, err := g.EvaluateChunk(context.Background(), &domain.Bundle{}, &domain.Request{}, nil)
	require.NoError(t, err)
	assert.Equal(t, domain.GuardrailAllow, verdict.Action)

	assert.Equal(t, 1.0, testutil.ToFloat64(r.guardrails.WithLabelValues(DirectionStreamChunk, VerdictFailOpen)))
	assert.Equal(t, 0.0, testutil.ToFloat64(r.guardrails.WithLabelValues(DirectionStreamChunk, VerdictAllow)))
}

// A genuine allow must stay an allow. Without this, "count fail_open" could be
// satisfied by counting every stream chunk as degraded.
func TestGuardrailCounter_StreamChunkGenuineAllowStaysAllow(t *testing.T) {
	r := New()
	g := WithGuardrailMetrics(stubGuardrails{
		verdict: domain.GuardrailVerdict{Action: domain.GuardrailAllow},
	}, r)

	_, err := g.EvaluateChunk(context.Background(), &domain.Bundle{}, &domain.Request{}, nil)
	require.NoError(t, err)

	assert.Equal(t, 1.0, testutil.ToFloat64(r.guardrails.WithLabelValues(DirectionStreamChunk, VerdictAllow)))
	assert.Equal(t, 0.0, testutil.ToFloat64(r.guardrails.WithLabelValues(DirectionStreamChunk, VerdictFailOpen)))
}

// stubTransport answers every request with a fixed status or error.
type stubTransport struct {
	status int
	err    error
}

func (s stubTransport) RoundTrip(*http.Request) (*http.Response, error) {
	if s.err != nil {
		return nil, s.err
	}
	return &http.Response{StatusCode: s.status, Body: http.NoBody}, nil
}

func TestRoundTripper_ClassifiesEndpoints(t *testing.T) {
	for _, tc := range []struct{ path, want string }{
		{"/api/internal/gateway/resolve-key", "resolve-key"},
		{"/api/internal/gateway/guardrail/check", "guardrail-check"},
		// The virtual-key id must never reach a label.
		{"/api/internal/gateway/config/vk_abc123", "config"},
		{"/api/internal/gateway/codex/refresh", "codex-refresh"},
		{"/api/internal/gateway/something-new", "unknown"},
	} {
		t.Run(tc.path, func(t *testing.T) {
			r := New()
			rt := WrapTransport(stubTransport{status: 200}, r)

			_, err := rt.RoundTrip(httptest.NewRequest(http.MethodGet, tc.path, nil))
			require.NoError(t, err)

			assert.Equal(t, 1.0, testutil.ToFloat64(r.controlPlane.WithLabelValues(tc.want, "200")))
		})
	}
}

func TestRoundTripper_LongPollIsNotTimed(t *testing.T) {
	r := New()
	rt := WrapTransport(stubTransport{status: 200}, r)

	// The change feed blocks until an event or its own timeout, so timing
	// it would swamp the buckets with a signal about nothing.
	_, err := rt.RoundTrip(httptest.NewRequest(http.MethodGet, "/api/internal/gateway/changes", nil))
	require.NoError(t, err)

	assert.Equal(t, 0, testutil.CollectAndCount(r.internalRTT))
	assert.Equal(t, 0, testutil.CollectAndCount(r.controlPlane))
}

func TestRoundTripper_TransportFailureCountsAsError(t *testing.T) {
	r := New()
	rt := WrapTransport(stubTransport{err: errors.New("dial tcp: connection refused")}, r)

	_, err := rt.RoundTrip(httptest.NewRequest(http.MethodGet, "/api/internal/gateway/resolve-key", nil))
	require.Error(t, err)

	assert.Equal(t, 1.0, testutil.ToFloat64(r.controlPlane.WithLabelValues("resolve-key", "error")))
}

func TestRoundTripper_WithoutRecorderIsPassthrough(t *testing.T) {
	inner := stubTransport{status: 200}
	assert.Equal(t, http.RoundTripper(inner), WrapTransport(inner, nil))
}

// stubStream is a stream iterator with a fixed chunk count and usage.
type stubStream struct {
	remaining int
	usage     domain.Usage
	closed    bool
}

func (s *stubStream) Next(context.Context) bool {
	if s.remaining <= 0 {
		return false
	}
	s.remaining--
	return true
}

func (s *stubStream) Chunk() []byte       { return []byte("chunk") }
func (s *stubStream) Usage() domain.Usage { return s.usage }
func (s *stubStream) Err() error          { return nil }
func (s *stubStream) Close() error        { s.closed = true; return nil }

func TestCountStream_TracksOpenStreams(t *testing.T) {
	r := New()
	inner := &stubStream{remaining: 1, usage: domain.Usage{TotalTokens: 10}}

	stream := CountStream(inner, r, "openai", "gpt-5-mini")
	assert.Equal(t, 1.0, testutil.ToFloat64(r.streamingOpen))

	for stream.Next(context.Background()) {
	}
	assert.Equal(t, 0.0, testutil.ToFloat64(r.streamingOpen))

	// Running dry and then being closed must not double-count.
	require.NoError(t, stream.Close())
	assert.Equal(t, 0.0, testutil.ToFloat64(r.streamingOpen))
	assert.True(t, inner.closed)
	assert.Equal(t, 0, testutil.CollectAndCount(r.streamNoUsage))
}

func TestCountStream_ReportsMissingUsage(t *testing.T) {
	r := New()
	// A stream that closes without usage debits nothing, which silently
	// bypasses budget enforcement.
	stream := CountStream(&stubStream{remaining: 1}, r, "openai", "gpt-5-mini")

	for stream.Next(context.Background()) {
	}

	assert.Equal(t, 1.0, testutil.ToFloat64(r.streamNoUsage.WithLabelValues("openai", "gpt-5-mini")))
}

func TestMiddleware_LabelsByRoutePatternNotRawPath(t *testing.T) {
	r := New()
	router := chi.NewRouter()
	router.Use(Middleware(r))
	router.Route("/v1beta", func(sub chi.Router) {
		sub.HandleFunc("/*", func(w http.ResponseWriter, req *http.Request) {
			// The Gemini surface embeds the model id in the path, so raw
			// paths would mint a series per model per caller.
			SetDispatchLabels(req.Context(), "gemini", "gemini-3-flash")
			w.WriteHeader(http.StatusOK)
		})
	})

	for _, path := range []string{
		"/v1beta/models/gemini-3-flash:generateContent",
		"/v1beta/models/gemini-3-pro:generateContent",
	} {
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, path, nil))
		require.Equal(t, http.StatusOK, rec.Code)
	}

	assert.Equal(t, 2.0, testutil.ToFloat64(r.httpRequests.WithLabelValues("/v1beta/*", "200", "gemini", "gemini-3-flash")))
	assert.Equal(t, 1, testutil.CollectAndCount(r.httpDuration), "both paths collapse onto one route series")
}

// @scenario "A rejection on an unmetered path is still written"
func TestMiddleware_SeedsTheRecorderOnTheRequestContext(t *testing.T) {
	r := New()
	router := chi.NewRouter()
	router.Use(Middleware(r))

	var seeded *Recorder
	router.Get("/v1/models", func(w http.ResponseWriter, req *http.Request) {
		// The error choke point is reached from helpers that never got the
		// router's dependencies; the request context is what they all hold.
		seeded = RecorderFromContext(req.Context())
		w.WriteHeader(http.StatusOK)
	})
	router.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/v1/models", nil))
	assert.Same(t, r, seeded)

	// A request that never passed through the middleware yields nil, and
	// every Recorder method is nil-safe, so recording stays unconditional.
	assert.Nil(t, RecorderFromContext(context.Background()))
	assert.NotPanics(t, func() {
		RecorderFromContext(context.Background()).RecordClientReject("bad_request", "vk_1")
	})
}

func TestMiddleware_RecordsStatusAndUnmatchedRoutes(t *testing.T) {
	r := New()
	router := chi.NewRouter()
	router.Use(Middleware(r))
	router.Get("/v1/models", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/v1/models", nil))
	require.Equal(t, http.StatusOK, rec.Code)

	// An unrouted request has no pattern; echoing the caller's path back as
	// a label is how a scraper gets flooded.
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/nope/"+strings.Repeat("x", 32), nil))
	require.Equal(t, http.StatusNotFound, rec.Code)

	assert.Equal(t, 1.0, testutil.ToFloat64(r.httpRequests.WithLabelValues("/v1/models", "200", "unknown", "unknown")))
	assert.Equal(t, 1.0, testutil.ToFloat64(r.httpRequests.WithLabelValues("unknown", "404", "unknown", "unknown")))
}

func TestMiddleware_SkipsProbesAndScrapes(t *testing.T) {
	r := New()
	router := chi.NewRouter()
	router.Use(Middleware(r))
	for _, path := range []string{"/healthz", "/readyz", "/startupz", "/metrics", "/health"} {
		router.Get(path, func(w http.ResponseWriter, _ *http.Request) {
			// The gauge must stay flat even while the operational request
			// is being served, so a drain watcher sees customer work only.
			assert.Equal(t, 0.0, testutil.ToFloat64(r.inFlight))
			w.WriteHeader(http.StatusOK)
		})
	}

	for _, path := range []string{"/healthz", "/readyz", "/startupz", "/metrics", "/health"} {
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		require.Equal(t, http.StatusOK, rec.Code)
	}

	// The kubelet probes every few seconds and Prometheus scrapes every
	// fifteen. Counting them would dominate the request total and dilute
	// the error-rate ratio the documented alert divides on.
	assert.Equal(t, 0, testutil.CollectAndCount(r.httpRequests))
	assert.Equal(t, 0, testutil.CollectAndCount(r.httpDuration))
}

func TestMiddleware_WithoutRecorderIsPassthrough(t *testing.T) {
	called := false
	handler := Middleware(nil)(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { called = true }))

	handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/", nil))

	assert.True(t, called)
}

func TestSetDispatchLabels_OutsideMiddlewareIsNoOp(t *testing.T) {
	assert.NotPanics(t, func() { SetDispatchLabels(context.Background(), "openai", "gpt-5-mini") })
}

func scrape(t *testing.T, r *Recorder) string {
	t.Helper()
	rec := httptest.NewRecorder()
	r.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/metrics", nil))
	require.Equal(t, http.StatusOK, rec.Code)
	return rec.Body.String()
}
