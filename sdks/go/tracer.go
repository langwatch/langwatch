package langwatch

import (
	"context"
	"fmt"

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
	// Build a fresh slice: appending to opts would write into the caller's
	// backing array whenever they passed their own slice with spare capacity.
	all := make([]trace.SpanStartOption, 0, len(opts)+1)
	all = append(all, opts...)
	all = append(all, trace.WithAttributes(sdkAttributes...))

	ctx, span := t.tracer.Start(ctx, name, all...)
	return ctx, &Span{span}
}

// WithActiveSpan starts a span, runs fn with the span-scoped context and the
// span, then ends the span automatically. This mirrors the TypeScript SDK's
// withActiveSpan and removes the boilerplate of deferring End and wiring up
// error status by hand.
//
// If fn returns an error, the span is marked Error and the error is recorded.
// If fn panics, the panic is recorded as an error on the span and re-raised so
// the caller's own recovery still sees it. On success the status is left Unset,
// the OTel default for "nothing went wrong": Ok is final and outranks Error, so
// setting it here would silently discard a status fn set itself.
func (t *LangWatchTracer) WithActiveSpan(
	ctx context.Context,
	name string,
	fn func(ctx context.Context, span *Span) error,
	opts ...trace.SpanStartOption,
) error {
	ctx, span := t.Start(ctx, name, opts...)
	defer span.End()

	// Registered second, so it runs first and can still record on the span
	// before the deferred End above closes it out during the re-raised panic.
	defer func() {
		if r := recover(); r != nil {
			panicErr := fmt.Errorf("panic: %v", r)
			span.SetStatus(codes.Error, panicErr.Error())
			span.RecordError(panicErr, trace.WithStackTrace(true))
			panic(r)
		}
	}()

	if err := fn(ctx, span); err != nil {
		span.SetStatus(codes.Error, err.Error())
		span.RecordError(err)
		return err
	}
	return nil
}
