package langwatch

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/codes"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
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

func TestWithActiveSpan(t *testing.T) {
	newTracer := func() (*LangWatchTracer, *tracetest.InMemoryExporter) {
		exporter := tracetest.NewInMemoryExporter()
		provider := sdktrace.NewTracerProvider(
			sdktrace.WithSpanProcessor(sdktrace.NewSimpleSpanProcessor(exporter)),
		)
		return TracerFromProvider(provider, "test"), exporter
	}

	t.Run("when fn succeeds it ends the span with an Ok status", func(t *testing.T) {
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
		assert.Equal(t, codes.Ok, spans[0].Status.Code)
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
