// Package otelsetup provides a generic OpenTelemetry bootstrap for any service.
// It configures tracing (and in future, metrics), registers globals, and returns
// a Provider whose Shutdown method flushes all pending telemetry.
//
// Service name, version, and environment are read from the context's ServiceInfo
// (see pkg/contexts). Override with Options fields if needed.
package otelsetup

import (
	"context"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	otelapi "go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"

	"github.com/langwatch/langwatch/pkg/contexts"
)

// startupErrorHandler silences OTLP export errors during the first few
// seconds of startup. The gateway commonly races its OTel exporter
// against control-plane readiness — the first few batches hit 401/503
// while auth is still being minted — and the default handler logs each
// batch as a WARN. Once we've seen a single successful export (signalled
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

// Options configures the telemetry provider. Fields left empty are filled from
// the context's ServiceInfo when available.
type Options struct {
	NodeID        string
	OTLPEndpoint string            // OTLP HTTP endpoint (empty = noop)
	OTLPHeaders  map[string]string // auth headers for the collector
	BatchTimeout  time.Duration
	MaxQueueSize  int
	// SampleRatio controls the fraction of traces sampled (0.0–1.0).
	// 0 means "use default" (AlwaysSample). Set explicitly via config.
	SampleRatio float64
}

// Provider holds the configured OTel SDK providers.
type Provider struct {
	tp *sdktrace.TracerProvider
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

	if opts.OTLPEndpoint == "" {
		return &Provider{}, nil
	}

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

	// Suppress startup-race auth/transport noise from the OTLP exporter —
	// the default handler emits WARN for every batch, which floods logs
	// for ~5s until the control-plane mints auth. The filter auto-disables
	// once the healthyExporter wrapper sees a successful export, or after
	// the 30s grace window elapses (whichever comes first).
	startupFilter := newStartupErrorHandler(
		otelapi.GetErrorHandler(),
		30*time.Second,
	)
	otelapi.SetErrorHandler(startupFilter)
	wrappedExp := healthyExporterWrap(exp, startupFilter.markHealthy)

	attrs := []attribute.KeyValue{
		semconv.ServiceName(serviceName),
		semconv.ServiceVersion(serviceVersion),
	}
	if environment != "" {
		attrs = append(attrs, attribute.String("deployment.environment.name", environment))
	}
	if opts.NodeID != "" {
		attrs = append(attrs, attribute.String("node.id", opts.NodeID))
	}

	res, _ := resource.Merge(
		resource.Default(),
		resource.NewWithAttributes(semconv.SchemaURL, attrs...),
	)

	batchTimeout := opts.BatchTimeout
	if batchTimeout == 0 {
		batchTimeout = 5 * time.Second
	}
	queueSize := opts.MaxQueueSize
	if queueSize == 0 {
		queueSize = 8192
	}

	var rootSampler sdktrace.Sampler
	if opts.SampleRatio > 0 && opts.SampleRatio < 1.0 {
		rootSampler = sdktrace.TraceIDRatioBased(opts.SampleRatio)
	} else {
		rootSampler = sdktrace.AlwaysSample()
	}

	tp := sdktrace.NewTracerProvider(
		sdktrace.WithResource(res),
		sdktrace.WithBatcher(wrappedExp,
			sdktrace.WithBatchTimeout(batchTimeout),
			sdktrace.WithMaxQueueSize(queueSize),
		),
		sdktrace.WithSampler(sdktrace.ParentBased(rootSampler)),
	)
	otelapi.SetTracerProvider(tp)

	return &Provider{tp: tp}, nil
}

// Shutdown flushes pending telemetry. Safe to call on a noop provider.
func (p *Provider) Shutdown(ctx context.Context) error {
	if p.tp != nil {
		return p.tp.Shutdown(ctx)
	}
	return nil
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
