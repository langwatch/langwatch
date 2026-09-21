package langwatch

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.opentelemetry.io/otel/trace"
)

// withGlobalProvider installs an in-memory-backed provider as the OTel global
// for the duration of the test, restoring the previous global on cleanup.
func withGlobalProvider(t *testing.T) *tracetest.InMemoryExporter {
	t.Helper()
	exporter := tracetest.NewInMemoryExporter()
	provider := sdktrace.NewTracerProvider(
		sdktrace.WithSpanProcessor(sdktrace.NewSimpleSpanProcessor(exporter)),
	)
	prev := otel.GetTracerProvider()
	otel.SetTracerProvider(provider)
	t.Cleanup(func() { otel.SetTracerProvider(prev) })
	return exporter
}

func TestTracer(t *testing.T) {
	t.Run("Tracer falls back to the global provider", func(t *testing.T) {
		exporter := withGlobalProvider(t)

		tracer := Tracer("global-test")
		_, span := tracer.Start(context.Background(), "op")
		span.SetInput("hi")
		span.End()

		spans := exporter.GetSpans()
		require.Len(t, spans, 1)
		assert.Equal(t, "op", spans[0].Name)
	})
}

func TestTracerFromProviderNilFallback(t *testing.T) {
	t.Run("TracerFromProvider with a nil provider uses the global provider", func(t *testing.T) {
		exporter := withGlobalProvider(t)

		tracer := TracerFromProvider(nil, "nil-provider-test")
		_, span := tracer.Start(context.Background(), "op")
		span.End()

		spans := exporter.GetSpans()
		require.Len(t, spans, 1)
	})
}

func TestStartLeavesCallerOptionsIntact(t *testing.T) {
	t.Run("it does not write the SDK attributes into the caller's backing array", func(t *testing.T) {
		exporter := tracetest.NewInMemoryExporter()
		provider := sdktrace.NewTracerProvider(
			sdktrace.WithSpanProcessor(sdktrace.NewSimpleSpanProcessor(exporter)),
		)
		tracer := TracerFromProvider(provider, "aliasing")

		// A caller keeping one option buffer and re-slicing it per span. The
		// first Start receives buf[:1], whose spare capacity is buf[1] — still
		// the caller's own option, and still due to be used.
		buf := make([]trace.SpanStartOption, 2)
		buf[0] = trace.WithAttributes(attribute.String("caller.first", "yes"))
		buf[1] = trace.WithAttributes(attribute.String("caller.second", "yes"))

		_, first := tracer.Start(context.Background(), "first", buf[:1]...)
		first.End()

		_, second := tracer.Start(context.Background(), "second", buf[1])
		second.End()

		spans := exporter.GetSpans()
		require.Len(t, spans, 2)

		firstAttrs := stubAttrs(spans[0])
		assert.Equal(t, "yes", firstAttrs["caller.first"].AsString())
		assert.Equal(t, "langwatch-sdk-go", firstAttrs[AttributeLangWatchSDKName].AsString())

		secondAttrs := stubAttrs(spans[1])
		assert.Equal(t, "yes", secondAttrs["caller.second"].AsString(),
			"the first Start must not have overwritten buf[1] with the SDK attributes")
		assert.Equal(t, "langwatch-sdk-go", secondAttrs[AttributeLangWatchSDKName].AsString())
	})
}

func stubAttrs(stub tracetest.SpanStub) map[attribute.Key]attribute.Value {
	attrs := make(map[attribute.Key]attribute.Value, len(stub.Attributes))
	for _, kv := range stub.Attributes {
		attrs[kv.Key] = kv.Value
	}
	return attrs
}

func TestWithActiveSpan(t *testing.T) {
	newTracer := func() (*LangWatchTracer, *tracetest.InMemoryExporter) {
		exporter := tracetest.NewInMemoryExporter()
		provider := sdktrace.NewTracerProvider(
			sdktrace.WithSpanProcessor(sdktrace.NewSimpleSpanProcessor(exporter)),
		)
		return TracerFromProvider(provider, "test"), exporter
	}

	t.Run("when fn succeeds it ends the span leaving the status unset", func(t *testing.T) {
		tracer, exporter := newTracer()

		var ran bool
		err := tracer.WithActiveSpan(context.Background(), "op", func(ctx context.Context, span *Span) error {
			ran = true
			span.SetInput("hi")
			return nil
		})
		require.NoError(t, err)

		assert.True(t, ran)
		spans := exporter.GetSpans()
		require.Len(t, spans, 1)
		assert.Equal(t, codes.Unset, spans[0].Status.Code)
	})

	t.Run("when fn sets an Error status and returns nil the status survives", func(t *testing.T) {
		tracer, exporter := newTracer()

		err := tracer.WithActiveSpan(context.Background(), "op", func(ctx context.Context, span *Span) error {
			span.SetStatus(codes.Error, "degraded")
			return nil
		})
		require.NoError(t, err)

		spans := exporter.GetSpans()
		require.Len(t, spans, 1)
		assert.Equal(t, codes.Error, spans[0].Status.Code, "an Ok status would have outranked and erased this")
		assert.Equal(t, "degraded", spans[0].Status.Description)
	})

	t.Run("when fn panics it records the panic, ends the span and re-raises", func(t *testing.T) {
		tracer, exporter := newTracer()

		assert.PanicsWithValue(t, "boom", func() {
			_ = tracer.WithActiveSpan(context.Background(), "op", func(ctx context.Context, span *Span) error {
				panic("boom")
			})
		})

		spans := exporter.GetSpans()
		require.Len(t, spans, 1, "the span must still be ended and exported")
		assert.Equal(t, codes.Error, spans[0].Status.Code)
		assert.Equal(t, "panic: boom", spans[0].Status.Description)
		require.NotEmpty(t, spans[0].Events, "the panic must be recorded as a span event")
	})

	t.Run("when fn fails it records the error and sets an Error status", func(t *testing.T) {
		tracer, exporter := newTracer()

		sentinel := errors.New("boom")
		err := tracer.WithActiveSpan(context.Background(), "op", func(ctx context.Context, span *Span) error {
			return sentinel
		})
		require.ErrorIs(t, err, sentinel)

		spans := exporter.GetSpans()
		require.Len(t, spans, 1)
		assert.Equal(t, codes.Error, spans[0].Status.Code)
		assert.Equal(t, "boom", spans[0].Status.Description)
		assert.NotEmpty(t, spans[0].Events, "the error should be recorded as a span event")
	})
}
