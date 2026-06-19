package openai

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/propagation"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	semconv "go.opentelemetry.io/otel/semconv/v1.40.0"

	langwatch "github.com/langwatch/langwatch/sdk-go"
)

func TestOptions(t *testing.T) {
	exporter := tracetest.NewInMemoryExporter()
	sp := sdktrace.NewSimpleSpanProcessor(exporter)
	traceProvider := sdktrace.NewTracerProvider(
		sdktrace.WithSpanProcessor(sp),
	)
	defer func() {
		_ = sp.Shutdown(context.Background())
		_ = exporter.Shutdown(context.Background())
	}()

	propagators := propagation.NewCompositeTextMapPropagator()

	tests := []struct {
		name         string
		opts         []Option
		expectedConf config
	}{
		{
			name: "Default config",
			opts: []Option{},
			expectedConf: config{
				tracerProvider: nil,
				propagators:    nil,
			},
		},
		{
			name: "With TracerProvider",
			opts: []Option{WithTracerProvider(traceProvider)},
			expectedConf: config{
				tracerProvider: traceProvider,
			},
		},
		{
			name: "With Propagators",
			opts: []Option{WithPropagators(propagators)},
			expectedConf: config{
				propagators: propagators,
			},
		},
		{
			name: "With DataCapture None",
			opts: []Option{WithDataCapture(langwatch.DataCaptureNone)},
			expectedConf: config{
				dataCapture: langwatch.DataCaptureNone,
			},
		},
		{
			name: "With DataCapture Input only",
			opts: []Option{WithDataCapture(langwatch.DataCaptureInput)},
			expectedConf: config{
				dataCapture: langwatch.DataCaptureInput,
			},
		},
		{
			name: "With GenAIProvider Groq",
			opts: []Option{WithGenAIProvider(semconv.GenAIProviderNameGroq)},
			expectedConf: config{
				genAIProvider: semconv.GenAIProviderNameGroq,
			},
		},
		{
			name: "With GenAIProvider Custom",
			opts: []Option{WithGenAIProvider(semconv.GenAIProviderNameKey.String("custom"))},
			expectedConf: config{
				genAIProvider: semconv.GenAIProviderNameKey.String("custom"),
			},
		},
		{
			// Exercises the deprecated WithGenAISystem alias, which forwards to
			// WithGenAIProvider, to keep the backwards-compatible path covered.
			name: "With GenAISystem deprecated alias",
			opts: []Option{WithGenAISystem(semconv.GenAIProviderNameGroq)},
			expectedConf: config{
				genAIProvider: semconv.GenAIProviderNameGroq,
			},
		},
		{
			name: "With All Options",
			opts: []Option{
				WithTracerProvider(traceProvider),
				WithPropagators(propagators),
				WithDataCapture(langwatch.DataCaptureAll),
				WithGenAIProvider(semconv.GenAIProviderNameGroq),
			},
			expectedConf: config{
				tracerProvider: traceProvider,
				propagators:    propagators,
				dataCapture:    langwatch.DataCaptureAll,
				genAIProvider:  semconv.GenAIProviderNameGroq,
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg := config{}
			for _, opt := range tt.opts {
				opt.apply(&cfg)
			}

			require.Equal(t, tt.expectedConf.tracerProvider, cfg.tracerProvider)
			require.Equal(t, tt.expectedConf.propagators, cfg.propagators)
			assert.Equal(t, tt.expectedConf.dataCapture, cfg.dataCapture)
			assert.Equal(t, tt.expectedConf.genAIProvider, cfg.genAIProvider)
		})
	}
}

var _ sdktrace.SpanExporter = &tracetest.InMemoryExporter{}
