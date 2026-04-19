// Package metrics owns every Prometheus counter / histogram / gauge
// emitted by the gateway. Registering in one place keeps the label
// cardinality auditable (explodes are easy; a single `SpanAttributes`
// label can take a pod OOM) and lets Andr's alerts cookbook point at
// stable metric names.
//
// Naming follows the langwatch-ai-gateway cookbook:
//
//   gateway_http_requests_total
//   gateway_http_request_duration_seconds
//   gateway_provider_attempts_total
//   gateway_circuit_state
//   gateway_budget_check_live_total
//   gateway_budget_debit_outbox_depth
//   gateway_budget_debit_outbox_capacity
//   gateway_budget_debit_outbox_dropped_total
//   gateway_budget_debit_outbox_flush_failures_total
//   gateway_budget_debit_outbox_4xx_drops_total
//   gateway_auth_cache_hits_total
//   gateway_auth_cache_misses_total
//   gateway_streaming_usage_missing_total
//   gateway_guardrail_verdicts_total
//   gateway_in_flight_requests
//   gateway_draining
//
// Every collector uses a custom registry (not the Prometheus default)
// so tests can swap in a fresh registry without pollution. main.go
// serves `/metrics` off this registry via promhttp.HandlerFor.
package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/collectors"
)

// Metrics groups every collector the gateway exposes. Instantiate
// once in main, share across packages.
type Metrics struct {
	Registry *prometheus.Registry

	HTTPRequests       *prometheus.CounterVec
	HTTPDuration       *prometheus.HistogramVec
	ProviderAttempts   *prometheus.CounterVec
	CircuitState       *prometheus.GaugeVec
	BudgetCheckLive    *prometheus.CounterVec
	BudgetOutboxDepth        prometheus.Gauge
	BudgetOutboxCapacity     prometheus.Gauge
	BudgetOutboxDrop         prometheus.Counter
	BudgetOutboxFlushFailure prometheus.Counter
	BudgetOutbox4xxDrop      prometheus.Counter
	AuthCacheHits      *prometheus.CounterVec
	AuthCacheMisses    prometheus.Counter
	StreamingNoUsage   *prometheus.CounterVec
	GuardrailVerdicts  *prometheus.CounterVec
	InFlightRequests   prometheus.Gauge
	Draining           prometheus.Gauge
}

// New builds a fresh Metrics bundle. Callers own the returned struct
// for the lifetime of the process; no globals.
func New() *Metrics {
	reg := prometheus.NewRegistry()
	// Surface Go runtime + process metrics (goroutines, memstats, fd
	// count) so the standard on-call toolkit works without extra wiring.
	reg.MustRegister(
		collectors.NewGoCollector(),
		collectors.NewProcessCollector(collectors.ProcessCollectorOpts{}),
	)

	m := &Metrics{Registry: reg}
	m.HTTPRequests = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "gateway_http_requests_total",
			Help: "Total gateway requests, by route / status / provider / model. Route is the chi pattern (/v1/chat/completions) to keep cardinality bounded.",
		},
		[]string{"route", "status", "provider", "model"},
	)
	m.HTTPDuration = prometheus.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:    "gateway_http_request_duration_seconds",
			Help:    "End-to-end gateway request latency — includes auth, guardrails, provider round-trip, debit enqueue.",
			Buckets: []float64{0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300},
		},
		[]string{"route", "provider"},
	)
	m.ProviderAttempts = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "gateway_provider_attempts_total",
			Help: "Fallback-engine attempts per credential, broken down by outcome (primary_success, fallback_success, retryable_5xx, rate_limit, timeout, network, circuit_open, non_retryable).",
		},
		[]string{"credential_id", "outcome"},
	)
	m.CircuitState = prometheus.NewGaugeVec(
		prometheus.GaugeOpts{
			Name: "gateway_circuit_state",
			Help: "Circuit breaker state per provider credential. 0=closed, 1=half_open, 2=open.",
		},
		[]string{"credential_id"},
	)
	m.BudgetCheckLive = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "gateway_budget_check_live_total",
			Help: "Outcome of the live /budget/check round-trip. `outcome` is one of: fired_allow, fired_block, skipped_cold, transport_error, timeout.",
		},
		[]string{"outcome"},
	)
	m.BudgetOutboxDepth = prometheus.NewGauge(
		prometheus.GaugeOpts{
			Name: "gateway_budget_debit_outbox_depth",
			Help: "Current in-memory depth of the debit outbox. Growing depth means the control plane is rejecting / slow; alert if >1000 for 5m.",
		},
	)
	m.BudgetOutboxCapacity = prometheus.NewGauge(
		prometheus.GaugeOpts{
			Name: "gateway_budget_debit_outbox_capacity",
			Help: "Configured maximum in-memory depth of the debit outbox ring buffer. Static per-pod; set once on startup from GATEWAY_BUDGET_OUTBOX_CAPACITY. Pair with _depth to compute fill pct.",
		},
	)
	m.BudgetOutboxDrop = prometheus.NewCounter(
		prometheus.CounterOpts{
			Name: "gateway_budget_debit_outbox_dropped_total",
			Help: "Debit events dropped because the outbox capacity was exceeded. Any non-zero increment is a paging event.",
		},
	)
	m.BudgetOutboxFlushFailure = prometheus.NewCounter(
		prometheus.CounterOpts{
			Name: "gateway_budget_debit_outbox_flush_failures_total",
			Help: "Flush batches that exhausted retries (control plane slow / unreachable / 5xx). Events are re-enqueued; positive rate over 5m means the control plane is degraded, sustained rate risks filling the ring and breaching capacity.",
		},
	)
	m.BudgetOutbox4xxDrop = prometheus.NewCounter(
		prometheus.CounterOpts{
			Name: "gateway_budget_debit_outbox_4xx_drops_total",
			Help: "Events the control plane rejected with a 4xx (excluding 429). Signals a signing / payload bug on the gateway side; these are lost. Any non-zero rate is a page.",
		},
	)
	m.AuthCacheHits = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "gateway_auth_cache_hits_total",
			Help: "Auth cache hits by tier (l1 / l2_redis).",
		},
		[]string{"tier"},
	)
	m.AuthCacheMisses = prometheus.NewCounter(
		prometheus.CounterOpts{
			Name: "gateway_auth_cache_misses_total",
			Help: "Cache misses that forced a resolve-key round-trip to the control plane.",
		},
	)
	m.StreamingNoUsage = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "gateway_streaming_usage_missing_total",
			Help: "Streaming responses that closed without the provider reporting token usage — these debit zero cost, which silently bypasses budget enforcement. Pages on a positive rate.",
		},
		[]string{"provider", "model"},
	)
	m.GuardrailVerdicts = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "gateway_guardrail_verdicts_total",
			Help: "Guardrail verdicts per direction. `verdict` is allow | block | modify; `direction` is request | response | stream_chunk.",
		},
		[]string{"direction", "verdict"},
	)
	m.InFlightRequests = prometheus.NewGauge(
		prometheus.GaugeOpts{
			Name: "gateway_in_flight_requests",
			Help: "Requests currently being handled by this pod. Tracked via middleware (Inc on entry, Dec on exit). Primary drain-progress signal during rollout; stalling above 0 for the whole grace period indicates stuck handlers.",
		},
	)
	m.Draining = prometheus.NewGauge(
		prometheus.GaugeOpts{
			Name: "gateway_draining",
			Help: "1 while the pod is draining (post-SIGTERM, pre-server-shutdown). Paired with in_flight_requests to let operators distinguish 'LB has stopped sending traffic' (draining=1, in_flight decreasing) from 'stuck drain' (draining=1, in_flight flat).",
		},
	)
	reg.MustRegister(
		m.HTTPRequests, m.HTTPDuration,
		m.ProviderAttempts, m.CircuitState,
		m.BudgetCheckLive,
		m.BudgetOutboxDepth, m.BudgetOutboxCapacity,
		m.BudgetOutboxDrop, m.BudgetOutboxFlushFailure, m.BudgetOutbox4xxDrop,
		m.AuthCacheHits, m.AuthCacheMisses,
		m.StreamingNoUsage, m.GuardrailVerdicts,
		m.InFlightRequests, m.Draining,
	)
	return m
}

// ObserveHTTPRequest records one request's completion.
func (m *Metrics) ObserveHTTPRequest(route, status, provider, model string, durationSeconds float64) {
	if m == nil {
		return
	}
	m.HTTPRequests.WithLabelValues(route, status, provider, model).Inc()
	m.HTTPDuration.WithLabelValues(route, provider).Observe(durationSeconds)
}

// RecordProviderAttempt is called once per fallback engine slot visited.
func (m *Metrics) RecordProviderAttempt(credentialID, outcome string) {
	if m == nil {
		return
	}
	m.ProviderAttempts.WithLabelValues(credentialID, outcome).Inc()
}

// SetCircuitState is called when a breaker transitions.
func (m *Metrics) SetCircuitState(credentialID string, state int) {
	if m == nil {
		return
	}
	m.CircuitState.WithLabelValues(credentialID).Set(float64(state))
}

// RecordBudgetCheck classifies a live /budget/check outcome.
func (m *Metrics) RecordBudgetCheck(outcome string) {
	if m == nil {
		return
	}
	m.BudgetCheckLive.WithLabelValues(outcome).Inc()
}

// RecordAuthCacheHit / Miss are called from the cache hot path.
func (m *Metrics) RecordAuthCacheHit(tier string) {
	if m == nil {
		return
	}
	m.AuthCacheHits.WithLabelValues(tier).Inc()
}

// RecordAuthCacheMiss is a shorthand for the counter.
func (m *Metrics) RecordAuthCacheMiss() {
	if m == nil {
		return
	}
	m.AuthCacheMisses.Inc()
}

// RecordStreamingNoUsage fires when a stream closed without the
// provider reporting usage. Labels let us route the alert to the
// specific model/provider caller so ops can nudge them to enable
// `stream_options: {include_usage: true}`.
func (m *Metrics) RecordStreamingNoUsage(provider, model string) {
	if m == nil {
		return
	}
	m.StreamingNoUsage.WithLabelValues(provider, model).Inc()
}

// RecordGuardrailVerdict is called from the guardrails client at each
// decision point.
func (m *Metrics) RecordGuardrailVerdict(direction, verdict string) {
	if m == nil {
		return
	}
	m.GuardrailVerdicts.WithLabelValues(direction, verdict).Inc()
}
