package langwatch

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/attribute"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
)

// TestEndToEndPipeline exercises the whole SDK pipeline: a span is recorded
// through a real TracerProvider + LangWatch tracer, then flows through a
// FilteringExporter (filter + data-capture predicate) into an in-memory
// exporter. It asserts content is stripped while structure survives.
func TestEndToEndPipeline(t *testing.T) {
	t.Run("a predicate-driven none mode strips content but keeps structure end to end", func(t *testing.T) {
		mem := tracetest.NewInMemoryExporter()

		// The LangWatch filtering exporter sits between the span processor and the
		// in-memory sink: it drops HTTP spans and, via the predicate, captures
		// nothing (DataCaptureNone) for every LangWatch span.
		fe := NewFilteringExporter(mem, ExcludeHTTPRequests())
		fe.dataCapture = dataCaptureConfig{
			enabled: true,
			predicate: func(c DataCaptureContext) DataCaptureMode {
				// Assert the predicate sees a fully populated context.
				require.NotEmpty(t, c.SpanName)
				if c.SpanType == "llm" {
					return DataCaptureNone
				}
				return DataCaptureAll
			},
		}

		provider := sdktrace.NewTracerProvider(
			sdktrace.WithSpanProcessor(sdktrace.NewSimpleSpanProcessor(fe)),
		)
		t.Cleanup(func() { _ = provider.Shutdown(context.Background()) })

		tracer := TracerFromProvider(provider, "integration")

		err := tracer.WithActiveSpan(context.Background(), "llm.generate", func(ctx context.Context, span *Span) error {
			span.SetType(SpanTypeLLM).
				SetRequestModel("gpt-5-mini").
				SetResponseModel("gpt-5-mini").
				SetGenAIProvider("openai").
				SetInputChatMessages([]ChatMessage{TextMessage(ChatRoleUser, "what is the capital of France?")}).
				SetOutputText("Paris").
				SetMetrics(SpanMetrics{PromptTokens: Int(12), CompletionTokens: Int(1), Cost: Float64(0.0003)}).
				SetTraceMetadata(attribute.String("feature", "geo-quiz")).
				SetThreadID("thread-1").
				SetRAGContext(SpanRAGContextChunk{DocumentID: "doc-1", Content: "Paris is the capital of France."})
			return nil
		})
		require.NoError(t, err)

		spans := mem.GetSpans()
		require.Len(t, spans, 1, "the single LLM span must reach the sink")

		span := spans[0]
		assert.Equal(t, "llm.generate", span.Name)

		keys := keySet(span.Attributes)

		// Content attributes are stripped by the none-mode predicate.
		assert.NotContains(t, keys, AttributeLangWatchInput, "input content must be stripped")
		assert.NotContains(t, keys, AttributeLangWatchOutput, "output content must be stripped")

		// Structure, models, metrics, metadata and identity all survive.
		assert.Contains(t, keys, AttributeLangWatchSpanType)
		assert.Contains(t, keys, AttributeLangWatchMetrics)
		assert.Contains(t, keys, attribute.Key("metadata.feature"))
		assert.Contains(t, keys, attribute.Key("gen_ai.conversation.id"))
		assert.Contains(t, keys, AttributeLangWatchRAGContexts)
		assert.Contains(t, keys, attribute.Key("gen_ai.request.model"))
		assert.Contains(t, keys, attribute.Key("gen_ai.response.model"))
		assert.Contains(t, keys, attribute.Key("gen_ai.provider.name"))
	})

	t.Run("an http span is filtered out before reaching the sink", func(t *testing.T) {
		mem := tracetest.NewInMemoryExporter()
		fe := NewFilteringExporter(mem, ExcludeHTTPRequests())

		provider := sdktrace.NewTracerProvider(
			sdktrace.WithSpanProcessor(sdktrace.NewSimpleSpanProcessor(fe)),
		)
		t.Cleanup(func() { _ = provider.Shutdown(context.Background()) })

		// Emit an HTTP-shaped span from a net/http-named instrumentation scope.
		httpTracer := provider.Tracer("net/http")
		_, httpSpan := httpTracer.Start(context.Background(), "GET /api")
		httpSpan.End()

		// And a LangWatch span that should survive.
		lwTracer := TracerFromProvider(provider, "app")
		_, lwSpan := lwTracer.Start(context.Background(), "llm.chat")
		lwSpan.SetType(SpanTypeLLM)
		lwSpan.End()

		spans := mem.GetSpans()
		require.Len(t, spans, 1)
		assert.Equal(t, "llm.chat", spans[0].Name)
	})
}
