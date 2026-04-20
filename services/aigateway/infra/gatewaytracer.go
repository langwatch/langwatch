package infra

import (
	"context"
	"net/http"
	"time"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
	"go.opentelemetry.io/otel/trace"
	"go.opentelemetry.io/otel/trace/noop"
)

// GatewayTracer handles OUR operational observability — latency, errors,
// provider timing, circuit state. Exported to our own collector.
// Separate from customer AI traces.
type GatewayTracer struct {
	tp         *sdktrace.TracerProvider
	tracer     trace.Tracer
	propagator propagation.TextMapPropagator
}

// GatewayTracerOptions configures the gateway's own tracer.
type GatewayTracerOptions struct {
	ServiceName    string
	ServiceVersion string
	NodeID         string
	Endpoint       string            // our OTLP collector endpoint (empty = noop)
	Headers        map[string]string // auth headers for our collector
	BatchTimeout   time.Duration
	MaxQueueSize   int
}

// NewGatewayTracer creates the gateway's operational tracer.
// The caller is responsible for installing the returned TracerProvider and
// Propagator globally (via otelapi.Set*) if desired.
func NewGatewayTracer(ctx context.Context, opts GatewayTracerOptions) (*GatewayTracer, error) {
	if opts.ServiceName == "" {
		opts.ServiceName = "langwatch-ai-gateway"
	}

	prop := propagation.NewCompositeTextMapPropagator(
		propagation.TraceContext{},
		propagation.Baggage{},
	)

	if opts.Endpoint == "" {
		return &GatewayTracer{
			tracer:     noop.NewTracerProvider().Tracer(opts.ServiceName),
			propagator: prop,
		}, nil
	}

	copts := []otlptracehttp.Option{
		otlptracehttp.WithEndpointURL(opts.Endpoint),
	}
	if len(opts.Headers) > 0 {
		copts = append(copts, otlptracehttp.WithHeaders(opts.Headers))
	}
	exp, err := otlptracehttp.New(ctx, copts...)
	if err != nil {
		return nil, err
	}

	res, _ := resource.Merge(
		resource.Default(),
		resource.NewWithAttributes(semconv.SchemaURL,
			semconv.ServiceName(opts.ServiceName),
			semconv.ServiceVersion(opts.ServiceVersion),
			attribute.String("langwatch.gateway.node_id", opts.NodeID),
		),
	)

	batchTimeout := opts.BatchTimeout
	if batchTimeout == 0 {
		batchTimeout = 5 * time.Second
	}
	queueSize := opts.MaxQueueSize
	if queueSize == 0 {
		queueSize = 8192
	}

	tp := sdktrace.NewTracerProvider(
		sdktrace.WithResource(res),
		sdktrace.WithBatcher(exp,
			sdktrace.WithBatchTimeout(batchTimeout),
			sdktrace.WithMaxQueueSize(queueSize),
		),
		sdktrace.WithSampler(sdktrace.ParentBased(sdktrace.AlwaysSample())),
	)

	return &GatewayTracer{
		tp:         tp,
		tracer:     tp.Tracer(opts.ServiceName),
		propagator: prop,
	}, nil
}

// TracerProvider returns the underlying TracerProvider (nil for noop).
func (g *GatewayTracer) TracerProvider() *sdktrace.TracerProvider {
	return g.tp
}

// Propagator returns the configured text map propagator.
func (g *GatewayTracer) Propagator() propagation.TextMapPropagator {
	return g.propagator
}

// Middleware creates a chi middleware that wraps each request in a gateway span.
func (g *GatewayTracer) Middleware(spanNamer func(*http.Request) string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			name := "lw_gateway.request"
			if spanNamer != nil {
				if n := spanNamer(r); n != "" {
					name = n
				}
			}

			// Always start a fresh root — never inherit client traceparent.
			// Our ops trace ID is ours; the customer's trace is separate.
			ctx, span := g.tracer.Start(r.Context(), name,
				trace.WithNewRoot(),
				trace.WithSpanKind(trace.SpanKindServer),
				trace.WithAttributes(
					attribute.String(AttrOrigin, OriginGateway),
					attribute.String("http.request.method", r.Method),
					attribute.String("url.path", r.URL.Path),
				),
			)
			sc := span.SpanContext()
			if sc.IsValid() {
				w.Header().Set(HeaderTraceID, sc.TraceID().String())
				w.Header().Set(HeaderSpanID, sc.SpanID().String())
			}

			rec := &statusRecorder{ResponseWriter: w, status: 200}
			defer func() {
				if rec.status >= 400 {
					span.SetStatus(codes.Error, http.StatusText(rec.status))
				} else {
					span.SetStatus(codes.Ok, "")
				}
				span.SetAttributes(attribute.Int("http.response.status_code", rec.status))
				span.End()
			}()

			next.ServeHTTP(rec, r.WithContext(ctx))
		})
	}
}

// Shutdown flushes pending spans.
func (g *GatewayTracer) Shutdown(ctx context.Context) error {
	if g.tp != nil {
		return g.tp.Shutdown(ctx)
	}
	return nil
}

// DefaultSpanName maps routes to canonical span names.
func DefaultSpanName(r *http.Request) string {
	switch r.URL.Path {
	case "/v1/chat/completions":
		return "lw_gateway.chat_completions"
	case "/v1/messages":
		return "lw_gateway.messages"
	case "/v1/embeddings":
		return "lw_gateway.embeddings"
	case "/v1/models":
		return "lw_gateway.models"
	}
	return "lw_gateway.request"
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(code int) {
	r.status = code
	r.ResponseWriter.WriteHeader(code)
}

func (r *statusRecorder) Flush() {
	if f, ok := r.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}
