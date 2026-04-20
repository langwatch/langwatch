package metrics

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/prometheus/client_golang/prometheus/testutil"
)

func TestNew_AllCollectorsRegistered(t *testing.T) {
	m := New()
	// Hit every helper so we catch any nil panics or bad label
	// counts without spinning a full server.
	m.ObserveHTTPRequest("/v1/chat/completions", "success", "openai", "gpt-5-mini", 0.42)
	m.RecordProviderAttempt("pc_primary", "primary_success")
	m.SetCircuitState("pc_primary", 0)
	m.RecordBudgetCheck("fired_allow")
	m.BudgetOutboxDepth.Set(7)
	m.BudgetOutboxCapacity.Set(10000)
	m.BudgetOutboxDrop.Inc()
	m.BudgetOutboxFlushFailure.Inc()
	m.BudgetOutbox4xxDrop.Inc()
	m.RecordAuthCacheHit("l1")
	m.RecordAuthCacheMiss()
	m.RecordStreamingNoUsage("openai", "gpt-5-mini")
	m.RecordGuardrailVerdict("request", "allow")
	m.InFlightRequests.Inc()
	m.Draining.Set(1)

	if got := testutil.ToFloat64(m.HTTPRequests.WithLabelValues("/v1/chat/completions", "success", "openai", "gpt-5-mini")); got != 1 {
		t.Errorf("requests_total want 1, got %f", got)
	}
	if got := testutil.ToFloat64(m.BudgetOutboxDepth); got != 7 {
		t.Errorf("outbox_depth want 7, got %f", got)
	}
}

func TestScrapeEndpoint_ReturnsPromFormat(t *testing.T) {
	m := New()
	// Emit one sample per vector so the scrape surfaces every metric
	// name (label-less vectors only print when they have children).
	m.ObserveHTTPRequest("/v1/chat/completions", "success", "openai", "gpt-5-mini", 0.1)
	m.RecordProviderAttempt("pc_primary", "primary_success")
	m.SetCircuitState("pc_primary", 0)
	m.RecordBudgetCheck("fired_allow")
	m.BudgetOutboxCapacity.Set(10000)
	m.BudgetOutboxDrop.Inc()
	m.BudgetOutboxFlushFailure.Inc()
	m.BudgetOutbox4xxDrop.Inc()
	m.RecordAuthCacheHit("l1")
	m.RecordStreamingNoUsage("openai", "gpt-5-mini")
	m.RecordGuardrailVerdict("request", "allow")
	m.InFlightRequests.Set(3)
	m.Draining.Set(0)
	srv := httptest.NewServer(promhttp.HandlerFor(m.Registry, promhttp.HandlerOpts{}))
	defer srv.Close()

	resp, err := http.Get(srv.URL)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("want 200, got %d", resp.StatusCode)
	}
	body, _ := io.ReadAll(resp.Body)
	text := string(body)
	for _, want := range []string{
		"gateway_http_requests_total",
		"gateway_http_request_duration_seconds_bucket",
		"gateway_provider_attempts_total",
		"gateway_circuit_state",
		"gateway_budget_check_live_total",
		"gateway_budget_debit_outbox_depth",
		"gateway_budget_debit_outbox_capacity",
		"gateway_budget_debit_outbox_dropped_total",
		"gateway_budget_debit_outbox_flush_failures_total",
		"gateway_budget_debit_outbox_4xx_drops_total",
		"gateway_auth_cache_hits_total",
		"gateway_auth_cache_misses_total",
		"gateway_streaming_usage_missing_total",
		"gateway_guardrail_verdicts_total",
		"gateway_in_flight_requests",
		"gateway_draining",
	} {
		if !strings.Contains(text, want) {
			t.Errorf("/metrics missing collector %q", want)
		}
	}
}

func TestNilReceiverIsSafe(t *testing.T) {
	// Callers stash a *Metrics pointer that may be nil in tests; all
	// recorder helpers must tolerate that without panicking.
	var m *Metrics
	m.ObserveHTTPRequest("a", "b", "c", "d", 1)
	m.RecordProviderAttempt("a", "b")
	m.SetCircuitState("a", 1)
	m.RecordBudgetCheck("fired_allow")
	m.RecordAuthCacheHit("l1")
	m.RecordAuthCacheMiss()
	m.RecordStreamingNoUsage("a", "b")
	m.RecordGuardrailVerdict("a", "b")
}
