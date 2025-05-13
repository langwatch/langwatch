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
	return &LangWatchTracer{
		tracer: otel.Tracer(name, options...),
	}
}

func (t *LangWatchTracer) Start(ctx context.Context, name string, opts ...trace.SpanStartOption) (context.Context, *Span) {
	ctx, span := t.tracer.Start(ctx, name, opts...)
	return ctx, &Span{span}
}
