package langwatch

import (
	"context"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/trace"
)

// LangWatchTracer is a wrapper around the OpenTelemetry tracer that adds LangWatch
// specific functionality.
type LangWatchTracer struct {
	tracer trace.Tracer
}

// Tracer creates a new LangWatchTracer with the given name and options.
func Tracer(name string, options ...trace.TracerOption) *LangWatchTracer {
	return &LangWatchTracer{
		tracer: otel.Tracer(name, options...),
	}
}

// TracerFromTracerProvider creates a new LangWatchTracer from a given tracer provider.
// This is useful when you want to create a LangWatchTracer from a tracer provider that
// is already configured, and not want to use the global tracer provider.
func TracerFromTracerProvider(provider trace.TracerProvider, name string, options ...trace.TracerOption) *LangWatchTracer {
	return &LangWatchTracer{
		tracer: provider.Tracer(name, options...),
	}
}

// Start starts a new span with the given name and options.
func (t *LangWatchTracer) Start(ctx context.Context, name string, opts ...trace.SpanStartOption) (context.Context, *Span) {
	ctx, span := t.tracer.Start(ctx, name, opts...)
	return ctx, &Span{span}
}
