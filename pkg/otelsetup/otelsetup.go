// Package otelsetup provides a generic OpenTelemetry bootstrap for any service.
// It configures tracing (and in future, metrics), registers globals, and returns
// a Provider whose Shutdown method flushes all pending telemetry.
//
// Service name, version, and environment are read from the context's ServiceInfo
// (see pkg/contexts). Override with Options fields if needed.
package otelsetup

import (
	"context"
	"errors"
	"log/slog"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	otelapi "go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/propagation"
	sdklog "go.opentelemetry.io/otel/sdk/log"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"

	"github.com/langwatch/langwatch/pkg/contexts"
)

// slogErrorHandler is the fallback delegate behind startupErrorHandler.
// Using a concrete handler — rather than whatever otelapi.GetErrorHandler()
// returns — is load-bearing: GetErrorHandler() returns the global
// *ErrDelegator wrapper, which forwards to the latest handler registered
// via SetErrorHandler. If we captured the delegator and then registered
// startupErrorHandler globally, dispatching any OTel error would recurse
// (startupErrorHandler.Handle → delegator → startupErrorHandler.Handle …)
// until the goroutine stack overflowed and the process exited with code 2.
type slogErrorHandler struct{}

func (slogErrorHandler) Handle(err error) {
	if err == nil {
		return
	}
	slog.Warn("otel error", "err", err)
}

// startupErrorHandler silences OTLP export errors during the first few
// seconds of startup. The gateway commonly races its OTel exporter
// against control-plane readiness — the first few batches hit 401/503
// while auth is still being minted — and the default handler logs each
// batch as a WARN. Once we've seen a single successful export (signaled
// by `markHealthy`), the filter unlocks and every error flows through
// normally again.
type startupErrorHandler struct {
	delegate otelapi.ErrorHandler
	until    time.Time
	healthy  atomic.Bool
	once     sync.Once
}

func newStartupErrorHandler(delegate otelapi.ErrorHandler, graceWindow time.Duration) *startupErrorHandler {
	return &startupErrorHandler{
		delegate: delegate,
		until:    time.Now().Add(graceWindow),
	}
}

func (h *startupErrorHandler) Handle(err error) {
	if err == nil {
		return
	}
	if h.healthy.Load() {
		h.delegate.Handle(err)
		return
	}
	if time.Now().Before(h.until) && isTransportAuthError(err) {
		// Swallow: grace-window auth/transport noise.
		return
	}
	h.delegate.Handle(err)
}

// markHealthy is called by a SpanProcessor wrapper after the first
// successful export batch. Flips the filter off for the rest of the
// process lifetime.
func (h *startupErrorHandler) markHealthy() {
	h.once.Do(func() { h.healthy.Store(true) })
}

func isTransportAuthError(err error) bool {
	s := err.Error()
	return strings.Contains(s, "401") ||
		strings.Contains(s, "403") ||
		strings.Contains(s, "unauthorized") ||
		strings.Contains(s, "Unauthorized") ||
		strings.Contains(s, "connection refused") ||
		strings.Contains(s, "no such host")
}

// BaggageKeyCausalityDepth is the W3C baggage key whose value is auto-
// stamped onto every span via BaggageAttributeProcessor. The
// `langwatch.reserved.*` prefix signals "system-set, do not override
// from client SDKs" — same convention as the rest of the reserved
// namespace. See specs/monitors/online-evaluator-loop-prevention.feature.
const BaggageKeyCausalityDepth = "langwatch.reserved.causality_depth"

// AutoStampedBaggageKeys lists the baggage keys that the default tracer
// provider copies onto every span at OnStart. Keep narrow — every entry
// adds one attribute lookup per span.
var AutoStampedBaggageKeys = []string{
	BaggageKeyCausalityDepth,
}

// BatchScheduledDelay is the BatchSpanProcessor scheduled export delay used by
// the default (single-tenant) pipeline when Options.BatchTimeout is unset. Kept
// short — vs the OTel ~5s default — so an uncatchable SIGKILL/OOM loses at most
// this window of buffered spans; the SIGTERM path force-flushes earlier still.
// This stays BATCH export (async, no per-span latency) — NOT synchronous export.
const BatchScheduledDelay = 2 * time.Second

// Options configures the telemetry provider. Fields left empty are filled from
// the context's ServiceInfo when available.
type Options struct {
	NodeID       string
	OTLPEndpoint string            // OTLP HTTP endpoint (empty = noop)
	OTLPHeaders  map[string]string // auth headers for the collector
	BatchTimeout time.Duration
	MaxQueueSize int
	// SampleRatio controls the fraction of traces sampled (0.0–1.0).
	// 0 means "use default" (AlwaysSample). Set explicitly via config.
	SampleRatio float64
	// MultiTenant=true installs a per-request, per-tenant span router
	// (TenantRouter) instead of the standard static-headers exporter.
	// Required for nlpgo: each Studio event arrives with its own
	// `workflow.api_key`, and a single Lambda container can serve
	// multiple projects back-to-back. Spans must reach LangWatch's
	// /api/otel/v1/traces with the originating project's
	// `X-Auth-Token` — never another tenant's key, never a static
	// admin token. When true, OTLPHeaders is ignored (the per-tenant
	// processors set their own auth).
	MultiTenant bool
	// SyncExport=true swaps each tenant's BatchSpanProcessor for a
	// SimpleSpanProcessor (sync OnEnd → exporter). Only honored when
	// MultiTenant=true. Purpose: deterministic test mode. The default
	// async BSP buffers spans for up to 5s then exports in batches;
	// under heavy concurrent test load on a saturated CI runner this
	// has been observed to extend the end-to-end "span emitted at
	// nlpgo → row in ClickHouse" wall-clock past any reasonable poll
	// budget. SimpleSpanProcessor blocks span.End() until the OTLP
	// roundtrip completes, so by the time the HTTP handler returns,
	// every span for that request has already been delivered to the
	// collector — no batching, no scheduled-delay window, no flake
	// surface. NEVER enable in production: synchronous export makes
	// every span pay the full collector RTT on the request hot path,
	// and a stalled collector wedges the request thread. Gated on the
	// NLPGO_SPAN_SYNC env var in deps.go.
	SyncExport bool

	// DebugCollectorEndpoint is an OPTIONAL second OTLP/HTTP endpoint
	// (base URL, no signal path) for a developer's local observability
	// stack. When non-empty it is ADDITIVE: an extra BatchSpanProcessor
	// dual-exports every span here (on both the MultiTenant and the
	// single-tenant paths) WITHOUT disturbing the primary product/ops
	// pipeline, and net-new OTLP logs + metrics pipelines are installed.
	// Empty (the default) leaves behavior byte-for-byte unchanged.
	DebugCollectorEndpoint string
	// DebugCollectorHeaders carries optional auth headers for the debug
	// collector exporters.
	DebugCollectorHeaders map[string]string
}

// Provider holds the configured OTel SDK providers.
type Provider struct {
	tp *sdktrace.TracerProvider
	lp *sdklog.LoggerProvider
	mp *sdkmetric.MeterProvider
}

// LoggerProvider returns the OTLP log provider, or nil when the debug
// collector is disabled. Consumers (clog) use it to tee zap output into
// the collector; deps.go relies on Shutdown to flush it, so callers do
// not own its lifecycle.
func (p *Provider) LoggerProvider() *sdklog.LoggerProvider {
	return p.lp
}

// buildResourceAttrs assembles the standard service.* + node.id
// resource attributes used by both the static and multi-tenant span
// pipelines. Kept as a helper so the two branches in New() stay in
// lockstep without copy-paste drift.
func buildResourceAttrs(serviceName, serviceVersion, environment, nodeID string) []attribute.KeyValue {
	attrs := []attribute.KeyValue{
		semconv.ServiceName(serviceName),
		semconv.ServiceVersion(serviceVersion),
	}
	if environment != "" {
		attrs = append(attrs, attribute.String("deployment.environment.name", environment))
	}
	if nodeID != "" {
		attrs = append(attrs, attribute.String("node.id", nodeID))
	}
	return attrs
}

// buildResource assembles the OTel resource shared by the trace, log,
// and metric pipelines so service.name / service.version /
// deployment.environment.name / node.id stay identical across every
// signal. Merge failure (schema-URL mismatch) is impossible here — all
// attrs use the same semconv schema — so the error is discarded, matching
// the existing trace-path call sites.
func buildResource(serviceName, serviceVersion, environment, nodeID string) *resource.Resource {
	attrs := buildResourceAttrs(serviceName, serviceVersion, environment, nodeID)
	res, _ := resource.Merge(
		resource.Default(),
		resource.NewWithAttributes(semconv.SchemaURL, attrs...),
	)
	return res
}

// withSignalPath appends the OTLP per-signal path (e.g. "/v1/traces")
// to a base collector endpoint if it is not already present. Mirrors the
// primary-endpoint logic in pkg/config/otel.go, but per-signal so the one
// debug-collector base URL fans out to /v1/traces, /v1/logs, /v1/metrics.
func withSignalPath(endpoint, signalPath string) string {
	if endpoint == "" || strings.HasSuffix(endpoint, signalPath) {
		return endpoint
	}
	return strings.TrimRight(endpoint, "/") + signalPath
}

// New creates the telemetry provider. If TraceEndpoint is empty, a noop
// provider is registered globally. Globals (TracerProvider, Propagator) are
// set before returning.
func New(ctx context.Context, opts Options) (*Provider, error) {
	info := contexts.GetServiceInfo(ctx)

	serviceName := "langwatch-service"
	serviceVersion := "dev"
	environment := ""
	if info != nil {
		if info.Service != "" {
			serviceName = info.Service
		}
		if info.Version != "" {
			serviceVersion = info.Version
		}
		environment = info.Environment
	}

	prop := propagation.NewCompositeTextMapPropagator(
		propagation.TraceContext{},
		propagation.Baggage{},
	)
	otelapi.SetTextMapPropagator(prop)

	// Nothing to install: no primary product/ops endpoint and no debug
	// collector. Returns the noop provider — behavior for everyone who
	// hasn't opted into the local observability stack is unchanged.
	if opts.OTLPEndpoint == "" && opts.DebugCollectorEndpoint == "" {
		return &Provider{}, nil
	}

	res := buildResource(serviceName, serviceVersion, environment, opts.NodeID)

	var rootSampler sdktrace.Sampler
	if opts.SampleRatio > 0 && opts.SampleRatio < 1.0 {
		rootSampler = sdktrace.TraceIDRatioBased(opts.SampleRatio)
	} else {
		rootSampler = sdktrace.AlwaysSample()
	}

	tpOpts := []sdktrace.TracerProviderOption{
		sdktrace.WithResource(res),
		sdktrace.WithSpanProcessor(NewBaggageAttributeProcessor(AutoStampedBaggageKeys...)),
		sdktrace.WithSampler(sdktrace.ParentBased(rootSampler)),
		sdktrace.WithIDGenerator(NewIDGenerator()),
	}

	// Primary product/ops span pipeline — unchanged from before the
	// debug-collector feature. The baggage processor above still runs
	// first (registration order), so it stamps attributes before either
	// the primary or the debug exporter sees the span.
	if opts.OTLPEndpoint != "" {
		if opts.MultiTenant {
			// nlpgo path: a TenantRouter routes each span to a per-tenant
			// otlptracehttp exporter constructed lazily with its own
			// `X-Auth-Token` sourced from the Studio event's
			// `workflow.api_key`. Static OTLPHeaders are intentionally NOT
			// applied here — they would be wrong for every tenant after
			// the first.
			router := NewTenantRouter(opts.OTLPEndpoint)
			if opts.SyncExport {
				router.newProcessor = newSyncTenantProcessor
			}
			tpOpts = append(tpOpts, sdktrace.WithSpanProcessor(router))
		} else {
			// aigateway path: a single static-headers batch exporter.
			exporterOpts := []otlptracehttp.Option{
				otlptracehttp.WithEndpointURL(opts.OTLPEndpoint),
			}
			if len(opts.OTLPHeaders) > 0 {
				exporterOpts = append(exporterOpts, otlptracehttp.WithHeaders(opts.OTLPHeaders))
			}
			exp, err := otlptracehttp.New(ctx, exporterOpts...)
			if err != nil {
				return nil, err
			}

			// Suppress startup-race auth/transport noise from the OTLP
			// exporter — the default handler emits WARN for every batch,
			// which floods logs for ~5s until the control-plane mints auth.
			// The filter auto-disables once the healthyExporter wrapper sees
			// a successful export, or after the 30s grace window elapses.
			startupFilter := newStartupErrorHandler(
				slogErrorHandler{},
				30*time.Second,
			)
			otelapi.SetErrorHandler(startupFilter)
			wrappedExp := healthyExporterWrap(exp, startupFilter.markHealthy)

			batchTimeout := opts.BatchTimeout
			if batchTimeout == 0 {
				batchTimeout = BatchScheduledDelay
			}
			queueSize := opts.MaxQueueSize
			if queueSize == 0 {
				queueSize = 8192
			}
			tpOpts = append(tpOpts,
				sdktrace.WithBatcher(wrappedExp,
					sdktrace.WithBatchTimeout(batchTimeout),
					sdktrace.WithMaxQueueSize(queueSize),
				),
			)
		}
	}

	// Additive debug-collector span exporter — dual export. Every span
	// (on both paths) is also batched to the developer's local collector.
	// This never diverts spans from the primary pipeline above.
	if opts.DebugCollectorEndpoint != "" {
		debugProc, err := newDebugSpanProcessor(ctx, opts.DebugCollectorEndpoint, opts.DebugCollectorHeaders)
		if err != nil {
			return nil, err
		}
		tpOpts = append(tpOpts, sdktrace.WithSpanProcessor(debugProc))
	}

	tp := sdktrace.NewTracerProvider(tpOpts...)
	otelapi.SetTracerProvider(tp)
	provider := &Provider{tp: tp}

	if err := installDebugSignals(ctx, opts, res, provider); err != nil {
		return nil, err
	}

	return provider, nil
}

// installDebugSignals attaches the debug collector's net-new OTLP log + metric
// pipelines to the provider and registers the global MeterProvider. Gated on
// the debug endpoint, so it's a no-op unless a developer opted into the local
// observability stack.
func installDebugSignals(ctx context.Context, opts Options, res *resource.Resource, provider *Provider) error {
	if opts.DebugCollectorEndpoint == "" {
		return nil
	}
	lp, err := newLoggerProvider(ctx, opts.DebugCollectorEndpoint, opts.DebugCollectorHeaders, res)
	if err != nil {
		return err
	}
	provider.lp = lp

	mp, err := newMeterProvider(ctx, opts.DebugCollectorEndpoint, opts.DebugCollectorHeaders, res)
	if err != nil {
		return err
	}
	otelapi.SetMeterProvider(mp)
	// Runtime metrics (GC, goroutines, mem) are the first cut — a start failure
	// must not sink service init, so warn and carry on.
	if err := startRuntimeMetrics(mp); err != nil {
		slog.Warn("otel runtime metrics start failed", "err", err)
	}
	provider.mp = mp
	return nil
}

// Shutdown flushes pending telemetry across every configured signal
// (traces, and — when the debug collector is enabled — logs + metrics).
// Safe to call on a noop provider. Registered as the "otel" lifecycle
// closer in each service's serve.go, so no extra closers are needed for
// the log/metric providers.
func (p *Provider) Shutdown(ctx context.Context) error {
	var errs []error
	if p.tp != nil {
		if err := p.tp.Shutdown(ctx); err != nil {
			errs = append(errs, err)
		}
	}
	if p.lp != nil {
		if err := p.lp.Shutdown(ctx); err != nil {
			errs = append(errs, err)
		}
	}
	if p.mp != nil {
		if err := p.mp.Shutdown(ctx); err != nil {
			errs = append(errs, err)
		}
	}
	return errors.Join(errs...)
}

// ForceFlush exports any pending spans synchronously. Safe to call on
// a noop provider.
//
// Mirrors langwatch_nlp commit 1f1d62f55 ("flush spans immediately
// after workflow execution to avoid ~180s ingestion delay caused by
// Lambda freezing the BatchSpanProcessor background thread"). On
// Lambda, the runtime freezes the process between invocations — any
// background-thread flush queued by the BatchSpanProcessor never
// runs, and spans only ship on the next thaw. Callers (request
// handlers) should `defer p.ForceFlush(ctx)` so spans for the just-
// finished request reach the collector before the freeze.
//
// Outside Lambda the cost is one extra exporter call per request —
// negligible vs the alternative of losing observability for the
// requests that triggered the failure path.
func (p *Provider) ForceFlush(ctx context.Context) error {
	var errs []error
	if p.tp != nil {
		if err := p.tp.ForceFlush(ctx); err != nil {
			errs = append(errs, err)
		}
	}
	// The log + metric providers are only set when the debug collector is
	// enabled; flushing them mirrors the per-request span flush so a
	// Lambda freeze can't strand debug logs/metrics either.
	if p.lp != nil {
		if err := p.lp.ForceFlush(ctx); err != nil {
			errs = append(errs, err)
		}
	}
	if p.mp != nil {
		if err := p.mp.ForceFlush(ctx); err != nil {
			errs = append(errs, err)
		}
	}
	return errors.Join(errs...)
}

// healthyExporter wraps a SpanExporter, invoking `onHealthy` the first
// time ExportSpans returns nil. Used to flip the startupErrorHandler
// filter off once the collector is actually answering.
type healthyExporter struct {
	inner     sdktrace.SpanExporter
	onHealthy func()
	once      sync.Once
}

func healthyExporterWrap(inner sdktrace.SpanExporter, onHealthy func()) sdktrace.SpanExporter {
	return &healthyExporter{inner: inner, onHealthy: onHealthy}
}

func (h *healthyExporter) ExportSpans(ctx context.Context, spans []sdktrace.ReadOnlySpan) error {
	err := h.inner.ExportSpans(ctx, spans)
	if err == nil {
		h.once.Do(h.onHealthy)
	}
	return err
}

func (h *healthyExporter) Shutdown(ctx context.Context) error {
	return h.inner.Shutdown(ctx)
}

// ForceFlushGlobal force-flushes whatever tracer and meter providers are
// currently installed as the OTel globals, best-effort and bounded by ctx. It
// exists for callers that do NOT hold a *Provider handle but must still ship
// buffered telemetry before the process may die — the process root on a fatal
// panic, or an early-shutdown hook that wants to flush before a slow drain.
//
// Because pkg/otelsetup installs its *sdktrace.TracerProvider as the global,
// this also flushes every span processor registered on it — including the
// langyagent internal-tee's BatchSpanProcessor, which is attached to the same
// global provider. A no-op provider (no endpoint configured) or one without
// ForceFlush is silently skipped.
//
// HONEST LIMIT: SIGKILL and OOM are uncatchable, so this cannot guarantee
// zero loss. It narrows the window for the failures the process CAN observe
// (SIGTERM, recovered-then-fatal panic); the short BatchScheduledDelay covers
// the rest.
func ForceFlushGlobal(ctx context.Context) {
	if tp, ok := otelapi.GetTracerProvider().(interface {
		ForceFlush(context.Context) error
	}); ok {
		_ = tp.ForceFlush(ctx)
	}
	if mp, ok := otelapi.GetMeterProvider().(interface {
		ForceFlush(context.Context) error
	}); ok {
		_ = mp.ForceFlush(ctx)
	}
}
