// Package gatewaymetrics owns every Prometheus collector the AI Gateway
// exposes, and the /metrics handler that serves them.
//
// Registering in one place keeps label cardinality auditable. Cardinality
// is the easy way to take a pod down: one unbounded label value multiplies
// every series by the size of its domain, so every label here is either a
// closed enum, a route pattern, or an identifier minted by the control
// plane. The one caller-influenced label, the model name on a virtual key
// that permits arbitrary names, is capped at a fixed number of distinct
// values before folding to a placeholder. See modelLabel.
//
// The metric names are a published contract: docs/ai-gateway/observability.mdx
// and the cookbooks under docs/ai-gateway/cookbooks/ tell self-hosted
// operators exactly what to scrape and alert on. docs_contract_test.go
// parses those docs and fails the build when a documented name is not
// registered here, which is what stops the surface from being dropped
// again in a restructure.
//
// Collectors live on a dedicated registry rather than the Prometheus
// default, so tests can build a fresh Recorder without cross-test
// pollution.
package gatewaymetrics

import (
	"context"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"sync"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/collectors"
	"github.com/prometheus/client_golang/prometheus/promhttp"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// TierL1 is the auth cache tier reported on the auth-cache metrics. The
// gateway caches virtual keys in each pod's own memory and nowhere else, so
// the label carries one value; it stays a label because these metric names
// are published and an operator's dashboard should not break to save a string.
const TierL1 = "l1"

// Guardrail verdict label values. Allow/block/modify mirror the control
// plane's decision; FailOpen is recorded when the guardrail service could
// not be reached and the gateway let the request through, which an
// operator must be able to tell apart from a real allow.
const (
	VerdictAllow    = "allow"
	VerdictBlock    = "block"
	VerdictModify   = "modify"
	VerdictFailOpen = "fail_open"
)

// Cache outcomes on gateway_cache_hits_total.
const (
	CacheOutcomeHit  = "hit"
	CacheOutcomeMiss = "miss"
)

// Drop reasons on gateway_spend_spool_dropped_total. Intake is a record the
// spool's writer could not accept (queue full, or the spool already closed);
// overflow is a sealed segment deleted to keep the spool inside its size
// bound. They separate a pod producing faster than it can write from a pod
// producing faster than it can ship.
const (
	SpoolDropIntake   = "intake"
	SpoolDropOverflow = "overflow"
)

// unknownLabel is the placeholder for a dimension that is genuinely not
// known at record time (a request rejected before model resolution has a
// provider, for instance). A fixed placeholder keeps the series countable
// instead of scattering empty-string labels.
const unknownLabel = "unknown"

// otherModel absorbs caller-supplied model names once the label budget is
// spent, so an unbounded stream of distinct names cannot mint a series
// each.
const otherModel = "other"

// durationBuckets covers the full spread of gateway latency, from a
// cached-auth rejection in single-digit milliseconds to a long-context
// completion running several minutes.
var durationBuckets = []float64{0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300}

// Recorder holds the gateway's collectors. Build one per process in
// NewDeps and share it; every method is safe on a nil Recorder so tests
// and partial wirings can leave it unset.
type Recorder struct {
	registry *prometheus.Registry
	// declared keeps every collector handed to the registry so
	// DeclaredNames can report the surface as it actually is, including
	// metrics that have no series yet.
	declared []prometheus.Collector

	httpRequests   *prometheus.CounterVec
	httpDuration   *prometheus.HistogramVec
	inFlight       prometheus.Gauge
	streamingOpen  prometheus.Gauge
	streamNoUsage  *prometheus.CounterVec
	providerTime   *prometheus.HistogramVec
	providerTries  *prometheus.CounterVec
	fallbackEvents *prometheus.CounterVec
	circuitState   *prometheus.GaugeVec
	authHits       *prometheus.CounterVec
	authMisses     *prometheus.CounterVec
	authLookups    prometheus.Counter
	budgetBlocks   *prometheus.CounterVec
	cacheHits      *prometheus.CounterVec
	cacheRuleHits  *prometheus.CounterVec
	guardrails     *prometheus.CounterVec
	internalRTT    *prometheus.HistogramVec
	controlPlane   *prometheus.CounterVec
	rateLimits     *prometheus.CounterVec
	clientRejects  *prometheus.CounterVec
	realtimeMints  *prometheus.CounterVec
	realtimeLimits *prometheus.CounterVec
	realtimeErrors *prometheus.CounterVec

	draining      gaugeSource
	authCacheSize gaugeSource
	spendSpool    spoolStatsSource

	// models bounds how many distinct caller-supplied model names may
	// become labels. See modelLabel.
	modelsMu sync.RWMutex
	models   map[string]struct{}
}

// New builds the collector set on a fresh registry.
func New() *Recorder {
	reg := prometheus.NewRegistry()
	// Go runtime and process collectors, so goroutine counts, heap and file
	// descriptors are on the same scrape as the gateway's own signals.
	reg.MustRegister(
		collectors.NewGoCollector(),
		collectors.NewProcessCollector(collectors.ProcessCollectorOpts{}),
	)

	r := &Recorder{registry: reg, models: map[string]struct{}{}}

	r.httpRequests = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "gateway_http_requests_total",
		Help: "Gateway requests by route, status, provider and model. Route is the chi route pattern (/v1/chat/completions), never the raw path, to keep cardinality bounded.",
	}, []string{"route", "status", "provider", "model"})

	r.httpDuration = prometheus.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "gateway_http_request_duration_seconds",
		Help:    "End-to-end gateway request latency, covering auth, guardrails and the provider round-trip.",
		Buckets: durationBuckets,
	}, []string{"route", "provider"})

	r.inFlight = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "gateway_in_flight_requests",
		Help: "Requests currently being handled by this pod. Read with gateway_draining to tell a stuck handler from a pod that has stopped receiving traffic.",
	})

	r.streamingOpen = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "gateway_streaming_active",
		Help: "Streaming responses currently open on this pod.",
	})

	r.streamNoUsage = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "gateway_streaming_usage_missing_total",
		Help: "Streams that closed without the provider reporting token usage. These debit nothing, which silently bypasses budget enforcement.",
	}, []string{"provider", "model"})

	r.providerTime = prometheus.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "gateway_provider_duration_seconds",
		Help:    "Upstream provider round-trip latency per dispatch attempt. Subtract from gateway_http_request_duration_seconds to isolate gateway overhead.",
		Buckets: durationBuckets,
	}, []string{"provider", "model"})

	r.providerTries = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "gateway_provider_attempts_total",
		Help: "Dispatch attempts per credential by outcome (success, fallback_success, retryable_5xx, not_found, rate_limit, timeout, network, circuit_open, non_retryable, chain_exhausted, context_done).",
	}, []string{"credential_id", "outcome"})

	r.fallbackEvents = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "gateway_fallback_events_total",
		Help: "Successful failovers, labeled by the credential that failed and the credential that served the request.",
	}, []string{"from_credential", "to_credential"})

	r.circuitState = prometheus.NewGaugeVec(prometheus.GaugeOpts{
		Name: "gateway_circuit_state",
		Help: "Circuit breaker state per provider credential: 0 closed, 1 open, 2 half-open.",
	}, []string{"credential_id"})

	r.authHits = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "gateway_auth_cache_hits_total",
		Help: "Virtual-key resolutions served from cache, by tier (l1).",
	}, []string{"tier"})

	r.authMisses = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "gateway_auth_cache_misses_total",
		Help: "Virtual-key lookups that missed a cache tier and had to fall through.",
	}, []string{"tier"})

	r.authLookups = prometheus.NewCounter(prometheus.CounterOpts{
		Name: "gateway_auth_cache_lookups_total",
		Help: "Virtual-key resolutions attempted. Denominator for the cache hit rate.",
	})

	r.budgetBlocks = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "gateway_budget_blocks_total",
		Help: "Requests rejected by budget precheck, labeled by the scope whose limit was breached.",
	}, []string{"scope"})

	r.realtimeMints = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "gateway_realtime_mints_total",
		Help: "Realtime voice session mint attempts, by vendor and outcome (minted, session_limit, registry_unavailable, provider_error). outcome=\"minted\" counts sessions admitted at mint, not billable usage: what a session costs is decided later by the vendor's report, and a session that never reports settles as unknown rather than zero.",
	}, []string{"vendor", "outcome"})

	r.realtimeLimits = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "gateway_realtime_session_limit_blocks_total",
		Help: "Mints refused because a virtual key already held its maximum open voice sessions. A rise means some key's cap is too low for its traffic, or that its sessions are not being closed. Which key is in the trace and the structured log; it is not a label, because virtual keys are tenant-created and unbounded.",
	}, []string{})

	r.realtimeErrors = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "gateway_realtime_registry_errors_total",
		Help: "Failed calls to the control plane's voice-session record, by operation (reserve, correlate, release, usage). A reserve failure refuses the mint; a correlate failure costs the session its exact join key to the vendor's report.",
	}, []string{"operation"})

	r.cacheHits = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "gateway_cache_hits_total",
		Help: "Prompt-cache effectiveness by outcome: hit when the provider reported cache-read tokens, miss otherwise.",
	}, []string{"outcome"})

	r.cacheRuleHits = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "gateway_cache_rule_hits_total",
		Help: "Cache-control rule matches, labeled by rule and by the mode applied after precedence resolution (RESPECT, FORCE, DISABLE).",
	}, []string{"rule_id", "mode_applied"})

	r.guardrails = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "gateway_guardrail_verdicts_total",
		Help: "Guardrail verdicts by direction (request, response, stream_chunk) and verdict (allow, block, modify, fail_open).",
	}, []string{"direction", "verdict"})

	r.internalRTT = prometheus.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "gateway_internal_rtt_seconds",
		Help:    "Round-trip latency of gateway to control-plane calls, by endpoint. Separates a slow control plane from a slow provider.",
		Buckets: durationBuckets,
	}, []string{"endpoint"})

	r.controlPlane = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "gateway_control_plane_requests_total",
		Help: "Gateway to control-plane calls by endpoint and response status. Status is `error` when the call never got a response.",
	}, []string{"endpoint", "status"})

	r.rateLimits = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "gateway_rate_limit_denied_total",
		Help: "Requests denied by a gateway rate limit, by the dimension that tripped (rpm, rpd) and the virtual key.",
	}, []string{"dimension", "vk_id"})

	r.clientRejects = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "gateway_client_rejects_total",
		Help: "Requests the gateway itself rejected as the caller's fault, by gateway error code and virtual key.",
	}, []string{"code", "vk_id"})

	r.register(
		prometheus.NewGaugeFunc(prometheus.GaugeOpts{
			Name: "gateway_draining",
			Help: "1 while the pod is draining (post-SIGTERM, pre-shutdown), 0 otherwise. Read with gateway_in_flight_requests to tell a stuck handler from a clean drain.",
		}, r.draining.value),
		prometheus.NewGaugeFunc(prometheus.GaugeOpts{
			Name:        "gateway_auth_cache_size",
			Help:        "Virtual keys currently held in the in-memory key cache.",
			ConstLabels: prometheus.Labels{"tier": TierL1},
		}, r.authCacheSize.value),
		prometheus.NewCounterFunc(prometheus.CounterOpts{
			Name: "gateway_spend_spool_appended_total",
			Help: "Spend records written to the on-disk spool. The denominator for the drop counters.",
		}, func() float64 { return float64(r.spendSpool.stats().Appended) }),
		prometheus.NewCounterFunc(prometheus.CounterOpts{
			Name:        "gateway_spend_spool_dropped_total",
			Help:        "Spend records lost before they could ship, by reason (intake, overflow). Gateway budget debits come from these records, so every drop is spend that is never billed and never enforced against.",
			ConstLabels: prometheus.Labels{"reason": SpoolDropIntake},
		}, func() float64 { return float64(r.spendSpool.stats().DroppedIntake) }),
		prometheus.NewCounterFunc(prometheus.CounterOpts{
			Name:        "gateway_spend_spool_dropped_total",
			Help:        "Spend records lost before they could ship, by reason (intake, overflow). Gateway budget debits come from these records, so every drop is spend that is never billed and never enforced against.",
			ConstLabels: prometheus.Labels{"reason": SpoolDropOverflow},
		}, func() float64 { return float64(r.spendSpool.stats().DroppedOverflow) }),
		r.httpRequests, r.httpDuration, r.inFlight,
		r.streamingOpen, r.streamNoUsage,
		r.providerTime, r.providerTries, r.fallbackEvents, r.circuitState,
		r.authHits, r.authMisses, r.authLookups,
		r.budgetBlocks, r.cacheHits, r.cacheRuleHits,
		r.guardrails, r.internalRTT, r.controlPlane, r.rateLimits,
		r.clientRejects,
		r.realtimeMints, r.realtimeLimits, r.realtimeErrors,
	)
	return r
}

func (r *Recorder) register(cs ...prometheus.Collector) {
	r.registry.MustRegister(cs...)
	r.declared = append(r.declared, cs...)
}

// descPattern pulls a metric's name and labels out of its descriptor.
// Prometheus exposes neither any other way, and reading them back off the
// descriptor is what keeps Declared honest: it reports what was actually
// registered, not a list somebody has to remember to update.
var descPattern = regexp.MustCompile(`fqName: "([^"]+)".*constLabels: \{([^}]*)\}, variableLabels: \{([^}]*)\}`)

// Declared describes one registered metric.
type Declared struct {
	Name string
	// Labels are the metric's own label names, constant and variable
	// together. Labels a scraper adds (namespace, pod, instance) are not
	// included: the gateway never sees them.
	Labels []string
}

// DeclaredMetrics returns every metric this recorder registers, including
// ones that have no series yet. An unused CounterVec emits nothing on a
// scrape, so gathering would silently under-report the surface the docs
// are checked against.
func (r *Recorder) DeclaredMetrics() []Declared {
	if r == nil {
		return nil
	}
	var out []Declared
	for _, c := range r.declared {
		descs := make(chan *prometheus.Desc, 16)
		go func(c prometheus.Collector) {
			c.Describe(descs)
			close(descs)
		}(c)
		for d := range descs {
			m := descPattern.FindStringSubmatch(d.String())
			if m == nil {
				continue
			}
			out = append(out, Declared{Name: m[1], Labels: parseLabelNames(m[2], m[3])})
		}
	}
	return out
}

// parseLabelNames flattens the descriptor's constant and variable label
// lists. Constant labels arrive as `tier="l1"`, variable ones as bare
// names.
func parseLabelNames(groups ...string) []string {
	var names []string
	for _, group := range groups {
		for _, field := range strings.Split(group, ",") {
			name, _, _ := strings.Cut(strings.TrimSpace(field), "=")
			if name != "" {
				names = append(names, name)
			}
		}
	}
	return names
}

// Registry exposes the collector registry, for the /metrics handler and
// for tests that gather directly.
func (r *Recorder) Registry() *prometheus.Registry {
	if r == nil {
		return nil
	}
	return r.registry
}

// Handler serves the Prometheus text exposition for this recorder.
func (r *Recorder) Handler() http.Handler {
	if r == nil {
		return http.NotFoundHandler()
	}
	return promhttp.HandlerFor(r.registry, promhttp.HandlerOpts{
		// A collector panicking must not take the pod's scrape endpoint
		// down; report it as a scrape error instead.
		ErrorHandling: promhttp.ContinueOnError,
	})
}

// TrackDraining points the drain gauge at the health registry's flag. The
// gauge itself is registered up front, so the metric exists whether or not
// the wiring layer gets around to calling this; an operator's alert on it
// must never depend on a constructor being remembered.
func (r *Recorder) TrackDraining(draining func() bool) {
	if r == nil || draining == nil {
		return
	}
	r.draining.set(func() float64 {
		if draining() {
			return 1
		}
		return 0
	})
}

// TrackAuthCacheSize points the cache-size gauge at the resolver's L1
// cache. Registered up front for the same reason as TrackDraining.
func (r *Recorder) TrackAuthCacheSize(size func() int) {
	if r == nil || size == nil {
		return
	}
	r.authCacheSize.set(func() float64 { return float64(size()) })
}

// SpoolStats is the spend spool's counter snapshot. Declared here rather
// than imported from the emitter so the collector set stays independent of
// how the spool is built.
type SpoolStats struct {
	Appended        uint64
	DroppedIntake   uint64
	DroppedOverflow uint64
}

// TrackSpendSpool points the spend-spool counters at the live spool.
// Registered up front for the same reason as TrackDraining, and left
// unattached when the spool failed to open: that pod serves without spend
// emission, and a flat zero series says so where a missing series would
// just look like a scrape problem.
func (r *Recorder) TrackSpendSpool(stats func() SpoolStats) {
	if r == nil || stats == nil {
		return
	}
	r.spendSpool.set(stats)
}

// spoolStatsSource is gaugeSource's counter equivalent: the spool is built
// after the registry, and may never be built at all.
type spoolStatsSource struct {
	mu sync.RWMutex
	fn func() SpoolStats
}

func (s *spoolStatsSource) set(fn func() SpoolStats) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.fn = fn
}

func (s *spoolStatsSource) stats() SpoolStats {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.fn == nil {
		return SpoolStats{}
	}
	return s.fn()
}

// gaugeSource lets a gauge be registered before the thing it measures
// exists. Written once during startup, read on every scrape.
type gaugeSource struct {
	mu sync.RWMutex
	fn func() float64
}

func (g *gaugeSource) set(fn func() float64) {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.fn = fn
}

// value reports 0 until a source is attached, which is the honest answer
// for "not draining" and "nothing cached yet".
func (g *gaugeSource) value() float64 {
	g.mu.RLock()
	defer g.mu.RUnlock()
	if g.fn == nil {
		return 0
	}
	return g.fn()
}

// ObserveHTTPRequest records one completed request.
func (r *Recorder) ObserveHTTPRequest(route string, status int, provider, model string, seconds float64) {
	if r == nil {
		return
	}
	route = orUnknown(route)
	provider = orUnknown(provider)
	r.httpRequests.WithLabelValues(route, strconv.Itoa(status), provider, orUnknown(model)).Inc()
	r.httpDuration.WithLabelValues(route, provider).Observe(seconds)
}

// RecordProviderAttempt records one dispatch attempt against a credential.
// Duration is the upstream round-trip; zero means the attempt never
// reached the provider (an open circuit, an exhausted chain) and is not
// timed.
func (r *Recorder) RecordProviderAttempt(credentialID, outcome, provider, model string, seconds float64) {
	if r == nil {
		return
	}
	r.providerTries.WithLabelValues(orUnknown(credentialID), orUnknown(outcome)).Inc()
	if seconds > 0 {
		r.providerTime.WithLabelValues(orUnknown(provider), orUnknown(model)).Observe(seconds)
	}
}

// RecordFallback records a failover from one credential to another.
func (r *Recorder) RecordFallback(fromCredential, toCredential string) {
	if r == nil {
		return
	}
	r.fallbackEvents.WithLabelValues(orUnknown(fromCredential), orUnknown(toCredential)).Inc()
}

// SetCircuitState publishes a credential's breaker state.
func (r *Recorder) SetCircuitState(credentialID string, state int) {
	if r == nil || credentialID == "" {
		return
	}
	r.circuitState.WithLabelValues(credentialID).Set(float64(state))
}

// RecordAuthCacheLookup counts a virtual-key resolution attempt.
func (r *Recorder) RecordAuthCacheLookup() {
	if r == nil {
		return
	}
	r.authLookups.Inc()
}

// RecordAuthCacheHit counts a resolution served by the given tier.
func (r *Recorder) RecordAuthCacheHit(tier string) {
	if r == nil {
		return
	}
	r.authHits.WithLabelValues(orUnknown(tier)).Inc()
}

// RecordAuthCacheMiss counts a tier that could not serve the resolution.
func (r *Recorder) RecordAuthCacheMiss(tier string) {
	if r == nil {
		return
	}
	r.authMisses.WithLabelValues(orUnknown(tier)).Inc()
}

// RecordBudgetBlock counts a request rejected by the named budget scope.
func (r *Recorder) RecordBudgetBlock(scope string) {
	if r == nil {
		return
	}
	r.budgetBlocks.WithLabelValues(orUnknown(scope)).Inc()
}

// RecordRealtimeMint exists because a voice session leaves no other trace at
// the moment it opens. Media never crosses the gateway, so this counter and
// the session row are the only evidence a mint happened, and the outcome split
// is what separates "the vendor refused" from "we refused" during an incident.
func (r *Recorder) RecordRealtimeMint(vendor, outcome string) {
	if r == nil {
		return
	}
	r.realtimeMints.WithLabelValues(orUnknown(vendor), orUnknown(outcome)).Inc()
}

// RecordRealtimeSessionLimitBlock is kept apart from the mint counter because
// it is the one refusal an operator can fix from the dashboard. A customer
// reporting that voice "randomly stops working" is answered by this line
// moving, and no query over the mint counter's outcome label is as direct.
func (r *Recorder) RecordRealtimeSessionLimitBlock() {
	if r == nil {
		return
	}
	r.realtimeLimits.WithLabelValues().Inc()
}

// RecordRealtimeRegistryError is the alarm for the failure mode that costs
// money silently. A reserve failure refuses the mint and the caller sees it; a
// correlate or release failure returns 200 to a caller who will never know the
// session lost its join key to the vendor's bill, or that it still counts
// against the key's cap. Nothing downstream of those two reports them.
func (r *Recorder) RecordRealtimeRegistryError(operation string) {
	if r == nil {
		return
	}
	r.realtimeErrors.WithLabelValues(orUnknown(operation)).Inc()
}

// RecordCacheOutcome counts prompt-cache effectiveness for one response.
func (r *Recorder) RecordCacheOutcome(usage domain.Usage) {
	if r == nil {
		return
	}
	outcome := CacheOutcomeMiss
	if usage.CacheReadTokens > 0 {
		outcome = CacheOutcomeHit
	}
	r.cacheHits.WithLabelValues(outcome).Inc()
}

// RecordCacheRuleHit counts a cache-control rule match. Mode is the mode
// applied after precedence resolution (header, then rule, then virtual-key
// default). It is upper-cased here to match the control plane's mode enum,
// which is upper-case on the wire precisely so operators can filter on it.
func (r *Recorder) RecordCacheRuleHit(ruleID, mode string) {
	if r == nil {
		return
	}
	r.cacheRuleHits.WithLabelValues(orUnknown(ruleID), strings.ToUpper(orUnknown(mode))).Inc()
}

// RecordGuardrailVerdict counts one guardrail decision.
func (r *Recorder) RecordGuardrailVerdict(direction, verdict string) {
	if r == nil {
		return
	}
	r.guardrails.WithLabelValues(orUnknown(direction), orUnknown(verdict)).Inc()
}

// RecordControlPlaneCall records one gateway to control-plane round trip.
func (r *Recorder) RecordControlPlaneCall(endpoint, status string, seconds float64) {
	if r == nil {
		return
	}
	endpoint = orUnknown(endpoint)
	r.internalRTT.WithLabelValues(endpoint).Observe(seconds)
	r.controlPlane.WithLabelValues(endpoint, orUnknown(status)).Inc()
}

// RecordRateLimitDenied counts a request rejected by a rate-limit ceiling.
func (r *Recorder) RecordRateLimitDenied(dimension, vkID string) {
	if r == nil {
		return
	}
	r.rateLimits.WithLabelValues(orUnknown(dimension), orUnknown(vkID)).Inc()
}

// RecordClientReject counts a request the gateway rejected as the caller's
// fault, keyed by the error code and the virtual key that sent it.
//
// The label set is the whole point, so it is worth being explicit about what
// is NOT here. Project and model are both omitted: project is redundant with
// the key (a virtual key belongs to exactly one project, and the log line
// already carries both), and model is caller-controlled on a key that permits
// arbitrary names, which is the same unbounded-label trap modelLabel exists to
// cap. Code is a closed enum of the gateway's own codes, and vk_id is minted
// by the control plane and bounded by the keys a deployment has issued, which
// is the pairing gateway_rate_limit_denied_total already uses.
func (r *Recorder) RecordClientReject(code, vkID string) {
	if r == nil {
		return
	}
	r.clientRejects.WithLabelValues(orUnknown(code), orUnknown(vkID)).Inc()
}

// StreamOpened marks a streaming response as open.
func (r *Recorder) StreamOpened() {
	if r == nil {
		return
	}
	r.streamingOpen.Inc()
}

// StreamClosed marks a streaming response as finished and records whether
// the provider ever reported token usage.
func (r *Recorder) StreamClosed(provider, model string, usage domain.Usage) {
	if r == nil {
		return
	}
	r.streamingOpen.Dec()
	if usage.TotalTokens == 0 && usage.PromptTokens == 0 && usage.CompletionTokens == 0 {
		r.streamNoUsage.WithLabelValues(orUnknown(provider), orUnknown(model)).Inc()
	}
}

// SetRequestLabels forwards the resolved provider and model to the HTTP
// middleware, which cannot see them itself.
func (r *Recorder) SetRequestLabels(ctx context.Context, provider, model string) {
	if r == nil {
		return
	}
	SetDispatchLabels(ctx, provider, model)
}

// WrapStream decorates a stream so the open-stream gauge and the
// missing-usage counter follow it to close.
func (r *Recorder) WrapStream(iter domain.StreamIterator, provider, model string) domain.StreamIterator {
	return CountStream(iter, r, provider, model)
}

// ModelLabel folds a caller-controlled model name onto a safe label value.
func (r *Recorder) ModelLabel(config domain.BundleConfig, model string) string {
	if r == nil {
		return unknownLabel
	}
	return r.modelLabel(config, model)
}

// VerdictLabel maps a guardrail action onto its label value.
func VerdictLabel(action domain.GuardrailAction) string {
	switch action {
	case domain.GuardrailBlock:
		return VerdictBlock
	case domain.GuardrailModify:
		return VerdictModify
	default:
		return VerdictAllow
	}
}

// vouchedModel reports whether the control plane named this model itself,
// as an alias target or an allowed-models entry. Such a name is operator
// configuration, not caller input, so it is always safe as a label.
func vouchedModel(config domain.BundleConfig, model string) bool {
	for _, alias := range config.ModelAliases {
		if alias.Model == model {
			return true
		}
	}
	for _, allowed := range config.AllowedModels {
		if allowed == model {
			return true
		}
	}
	return false
}

// modelLabelBudget caps how many distinct caller-supplied model names may
// become labels. A virtual key can be configured to permit arbitrary model
// names, which makes the request field caller-controlled: without a cap one
// client looping over random strings mints a series per string until the
// pod dies. The cap is generous enough that a real deployment never
// reaches it, and past it further names fold onto a placeholder rather
// than taking the process down.
const modelLabelBudget = 100

// modelLabel folds a model name onto a value that is safe as a label.
// A control-plane-vouched name always survives. Anything else survives
// only while the budget lasts, which keeps the ordinary case (a handful of
// models per deployment) readable without trusting caller input.
func (r *Recorder) modelLabel(config domain.BundleConfig, model string) string {
	if model == "" {
		return unknownLabel
	}
	if vouchedModel(config, model) {
		return model
	}

	r.modelsMu.RLock()
	_, seen := r.models[model]
	full := len(r.models) >= modelLabelBudget
	r.modelsMu.RUnlock()
	if seen {
		return model
	}
	if full {
		return otherModel
	}

	r.modelsMu.Lock()
	defer r.modelsMu.Unlock()
	if _, seen := r.models[model]; seen {
		return model
	}
	if len(r.models) >= modelLabelBudget {
		return otherModel
	}
	if r.models == nil {
		r.models = map[string]struct{}{}
	}
	r.models[model] = struct{}{}
	return model
}

func orUnknown(v string) string {
	if v == "" {
		return unknownLabel
	}
	return v
}
