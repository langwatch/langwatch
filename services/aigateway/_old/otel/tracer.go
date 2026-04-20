package otel

import (
	"context"
	"log/slog"
	"time"

	otelapi "go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
	"go.opentelemetry.io/otel/trace"
	"go.opentelemetry.io/otel/trace/noop"
)

// Provider is the gateway's tracer — a thin wrapper that owns the
// SDK TracerProvider, a TextMapPropagator configured for W3C Trace
// Context, and a convenience tracer. Call [Shutdown] on clean exit so
// the batch processor can drain.
type Provider struct {
	tp         *sdktrace.TracerProvider
	propagator propagation.TextMapPropagator
	tracer     trace.Tracer
	router     *RouterExporter
	logger     *slog.Logger
}

// ProviderOptions configures a gateway OTel provider.
type ProviderOptions struct {
	ServiceName    string
	ServiceVersion string
	GatewayNodeID  string
	Logger         *slog.Logger
	Router         *RouterExporter
	BatchTimeout   time.Duration
	MaxQueueSize   int
}

// New builds a Provider backed by the given RouterExporter. If Router
// is nil, a no-op tracer is returned (spans are created but go nowhere)
// — useful for tests and dev without an OTLP collector.
func New(opts ProviderOptions) *Provider {
	if opts.Logger == nil {
		opts.Logger = slog.Default()
	}
	if opts.ServiceName == "" {
		opts.ServiceName = "langwatch-ai-gateway"
	}
	prop := propagation.NewCompositeTextMapPropagator(
		propagation.TraceContext{},
		propagation.Baggage{},
	)
	if opts.Router == nil {
		// No exporter: wire a noop tracer but still set the global
		// propagator so inbound traceparent ctx is honored.
		otelapi.SetTextMapPropagator(prop)
		return &Provider{
			propagator: prop,
			tracer:     noop.NewTracerProvider().Tracer(opts.ServiceName),
			logger:     opts.Logger,
		}
	}
	res, _ := resource.Merge(
		resource.Default(),
		resource.NewWithAttributes(semconv.SchemaURL,
			semconv.ServiceName(opts.ServiceName),
			semconv.ServiceVersion(opts.ServiceVersion),
			attribute.String("langwatch.gateway.node_id", opts.GatewayNodeID),
		),
	)
	bsp := sdktrace.NewBatchSpanProcessor(opts.Router,
		sdktrace.WithBatchTimeout(nonZero(opts.BatchTimeout, 5*time.Second)),
		sdktrace.WithMaxQueueSize(nonZeroInt(opts.MaxQueueSize, 8192)),
	)
	tp := sdktrace.NewTracerProvider(
		sdktrace.WithResource(res),
		sdktrace.WithSpanProcessor(bsp),
		sdktrace.WithSampler(sdktrace.ParentBased(sdktrace.AlwaysSample())),
	)
	otelapi.SetTracerProvider(tp)
	otelapi.SetTextMapPropagator(prop)
	return &Provider{
		tp:         tp,
		propagator: prop,
		tracer:     tp.Tracer(opts.ServiceName),
		router:     opts.Router,
		logger:     opts.Logger,
	}
}

// Tracer returns the underlying tracer for direct span creation.
func (p *Provider) Tracer() trace.Tracer { return p.tracer }

// Propagator returns the W3C Trace Context propagator so callers (e.g.
// the middleware) can extract/inject headers without re-creating it.
func (p *Provider) Propagator() propagation.TextMapPropagator { return p.propagator }

// Shutdown flushes pending spans and closes exporters. Safe on nil.
func (p *Provider) Shutdown(ctx context.Context) error {
	if p == nil {
		return nil
	}
	if p.tp != nil {
		if err := p.tp.Shutdown(ctx); err != nil {
			return err
		}
	}
	if p.router != nil {
		return p.router.Shutdown(ctx)
	}
	return nil
}

// ExtractParent returns a context populated with the parent span
// context carried by the W3C traceparent / tracestate headers on the
// supplied HTTP-header carrier. If no traceparent is present, the
// original context is returned unchanged (the subsequent StartSpan
// will create a new trace root).
func (p *Provider) ExtractParent(ctx context.Context, carrier propagation.TextMapCarrier) context.Context {
	return p.propagator.Extract(ctx, carrier)
}

// InjectInto copies the active span's traceparent/tracestate onto the
// supplied carrier (typically response headers).
func (p *Provider) InjectInto(ctx context.Context, carrier propagation.TextMapCarrier) {
	p.propagator.Inject(ctx, carrier)
}

func nonZero(d, def time.Duration) time.Duration {
	if d <= 0 {
		return def
	}
	return d
}
func nonZeroInt(n, def int) int {
	if n <= 0 {
		return def
	}
	return n
}
