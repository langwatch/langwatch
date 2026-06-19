package langwatch

import (
	"context"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"
)

type LangWatchTracer struct {
	tracer trace.Tracer
}

// sdkAttributes identify the LangWatch SDK on every span the tracer starts, so
// the SDK name/version/language land in the trace data for analytics (in
// addition to the OTLP export headers).
var sdkAttributes = []attribute.KeyValue{
	AttributeLangWatchSDKName.String("langwatch-sdk-go"),
	AttributeLangWatchSDKLanguage.String("go"),
	AttributeLangWatchSDKVersion.String(Version),
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
	opts = append(opts, trace.WithAttributes(sdkAttributes...))
	ctx, span := t.tracer.Start(ctx, name, opts...)
	return ctx, &Span{span}
}

// WithActiveSpan starts a span, runs fn with the span-scoped context and the
// span, then ends the span automatically. If fn returns an error, the span is
// marked with an Error status and the error is recorded; otherwise the status
// is set to Ok. This mirrors the TypeScript SDK's withActiveSpan and removes the
// boilerplate of deferring End and wiring up error status by hand.
func (t *LangWatchTracer) WithActiveSpan(
	ctx context.Context,
	name string,
	fn func(ctx context.Context, span *Span) error,
	opts ...trace.SpanStartOption,
) error {
	ctx, span := t.Start(ctx, name, opts...)
	defer span.End()

	if err := fn(ctx, span); err != nil {
		span.SetStatus(codes.Error, err.Error())
		span.RecordError(err)
		return err
	}

	span.SetStatus(codes.Ok, "")
	return nil
}
