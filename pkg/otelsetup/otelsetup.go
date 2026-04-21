// Package otelsetup provides a generic OpenTelemetry bootstrap for any service.
// It configures tracing (and in future, metrics), registers globals, and returns
// a Provider whose Shutdown method flushes all pending telemetry.
//
// Service name, version, and environment are read from the context's ServiceInfo
// (see pkg/contexts). Override with Options fields if needed.
package otelsetup

import (
	"context"
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

// Options configures the telemetry provider. Fields left empty are filled from
// the context's ServiceInfo when available.
type Options struct {
	NodeID        string
	TraceEndpoint string            // OTLP HTTP endpoint (empty = noop)
	TraceHeaders  map[string]string // auth headers for the collector
	BatchTimeout  time.Duration
	MaxQueueSize  int
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

	if opts.TraceEndpoint == "" {
		return &Provider{}, nil
	}

	exporterOpts := []otlptracehttp.Option{
		otlptracehttp.WithEndpointURL(opts.TraceEndpoint),
	}
	if len(opts.TraceHeaders) > 0 {
		exporterOpts = append(exporterOpts, otlptracehttp.WithHeaders(opts.TraceHeaders))
	}
	exp, err := otlptracehttp.New(ctx, exporterOpts...)
	if err != nil {
		return nil, err
	}

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

	tp := sdktrace.NewTracerProvider(
		sdktrace.WithResource(res),
		sdktrace.WithBatcher(exp,
			sdktrace.WithBatchTimeout(batchTimeout),
			sdktrace.WithMaxQueueSize(queueSize),
		),
		sdktrace.WithSampler(sdktrace.ParentBased(sdktrace.AlwaysSample())),
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
