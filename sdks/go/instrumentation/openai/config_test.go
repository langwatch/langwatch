package openai

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/propagation"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	semconv "go.opentelemetry.io/otel/semconv/v1.30.0"
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
				recordInput:    false,
				recordOutput:   false,
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
			name: "With Input Content",
			opts: []Option{WithCaptureInput()},
			expectedConf: config{
				recordInput: true,
			},
		},
		{
			name: "With Output Content",
			opts: []Option{WithCaptureOutput()},
			expectedConf: config{
				recordOutput: true,
			},
		},
		{
			name: "With GenAISystem Groq",
			opts: []Option{WithGenAISystem(semconv.GenAISystemGroq)},
			expectedConf: config{
				genAISystem: semconv.GenAISystemGroq,
			},
		},
		{
			name: "With GenAISystem Custom",
			opts: []Option{WithGenAISystem(semconv.GenAISystemKey.String("custom"))},
			expectedConf: config{
				genAISystem: semconv.GenAISystemKey.String("custom"),
			},
		},
		{
			name: "With All Options",
			opts: []Option{
				WithTracerProvider(traceProvider),
				WithPropagators(propagators),
				WithCaptureInput(),
				WithCaptureOutput(),
				WithGenAISystem(semconv.GenAISystemGroq),
			},
			expectedConf: config{
				tracerProvider: traceProvider,
				propagators:    propagators,
				recordInput:    true,
				recordOutput:   true,
				genAISystem:    semconv.GenAISystemGroq,
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
			assert.Equal(t, tt.expectedConf.recordInput, cfg.recordInput)
			assert.Equal(t, tt.expectedConf.recordOutput, cfg.recordOutput)
		})
	}
}

var _ sdktrace.SpanExporter = &tracetest.InMemoryExporter{}
