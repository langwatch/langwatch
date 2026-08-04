package langwatch

import (
	"context"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/trace"
)

type LangWatchTracer struct {
	tracer trace.Tracer
}

func Tracer(name string, options ...trace.TracerOption) *LangWatchTracer {
	return TracerFromProvider(nil, name, options...)
}

// TracerFromProvider creates a LangWatchTracer using the given TracerProvider
// instead of the global one. If provider is nil, it falls back to the global TracerProvider.
func TracerFromProvider(provider trace.TracerProvider, name string, options ...trace.TracerOption) *LangWatchTracer {
	if provider == nil {
		provider = otel.GetTracerProvider()
	}
	return &LangWatchTracer{
		tracer: provider.Tracer(name, options...),
	}
}

func (t *LangWatchTracer) Start(ctx context.Context, name string, opts ...trace.SpanStartOption) (context.Context, *Span) {
	ctx, span := t.tracer.Start(ctx, name, opts...)
	return ctx, &Span{span}
}
