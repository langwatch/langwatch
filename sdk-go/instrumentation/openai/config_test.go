package openai

import (
	"context"
	"testing"

	"github.com/langwatch/langwatch/sdk-go/instrumentation/openai/events"
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
				tracerProvider:      nil,
				propagators:         nil,
				contentRecordPolicy: nil,
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
			name: "With Capture All Input",
			opts: []Option{WithCaptureAllInput()},
			expectedConf: config{
				contentRecordPolicy: &events.RecordPolicyConfig{
					RecordSystemInputContent: true,
					RecordUserInputContent:   true,
					RecordOutputContent:      false,
				},
			},
		},
		{
			name: "With System Input Content",
			opts: []Option{WithCaptureSystemInput()},
			expectedConf: config{
				contentRecordPolicy: &events.RecordPolicyConfig{
					RecordSystemInputContent: true,
				},
			},
		},
		{
			name: "With User Input Content",
			opts: []Option{WithCaptureUserInput()},
			expectedConf: config{
				contentRecordPolicy: &events.RecordPolicyConfig{
					RecordUserInputContent: true,
				},
			},
		},
		{
			name: "With Output Content",
			opts: []Option{WithCaptureOutput()},
			expectedConf: config{
				contentRecordPolicy: &events.RecordPolicyConfig{
					RecordOutputContent: true,
				},
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
				WithCaptureSystemInput(),
				WithCaptureUserInput(),
				WithCaptureOutput(),
				WithGenAISystem(semconv.GenAISystemGroq),
			},
			expectedConf: config{
				tracerProvider: traceProvider,
				propagators:    propagators,
				contentRecordPolicy: &events.RecordPolicyConfig{
					RecordSystemInputContent: true,
					RecordUserInputContent:   true,
					RecordOutputContent:      true,
				},
				genAISystem: semconv.GenAISystemGroq,
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
			assert.Equal(t, tt.expectedConf.contentRecordPolicy, cfg.contentRecordPolicy)
			assert.Equal(t, tt.expectedConf.genAISystem, cfg.genAISystem)
		})
	}
}

var _ sdktrace.SpanExporter = &tracetest.InMemoryExporter{}
