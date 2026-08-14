package customertracebridge

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/propagation"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// Audio tokens on the customer span. domain.Usage carries them OUT of the
// prompt and completion totals so the billing wire can price them at their
// own rate. The span has no audio-token attribute to price from, so it folds
// them back in: a trace costs what it always did, and an audio-native answer
// is not mistaken for an empty one.

// recordChatSpanForUsage runs the emitter's span lifecycle for a chat-shaped
// request, which is the shape the empty-probe filter applies to.
func recordChatSpanForUsage(t *testing.T, u domain.Usage) sdktrace.ReadOnlySpan {
	t.Helper()
	sr := tracetest.NewSpanRecorder()
	tp := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(sr))
	e := &Emitter{tp: tp, tracer: tp.Tracer("test"), propagator: propagation.TraceContext{}}

	ctx, _ := e.BeginSpan(context.Background(), "proj-test", domain.RequestTypeChat)
	e.EndSpan(ctx, domain.AITraceParams{
		ProviderID:  domain.ProviderOpenAI,
		Model:       "gpt-realtime",
		RequestType: domain.RequestTypeChat,
		Usage:       u,
	})

	spans := sr.Ended()
	require.Len(t, spans, 1)
	return spans[0]
}

func hasDropMarker(span sdktrace.ReadOnlySpan) bool {
	for _, kv := range span.Attributes() {
		if string(kv.Key) == string(attrDrop) {
			return kv.Value.AsBool()
		}
	}
	return false
}

func TestEmitter_AudioTokens_CountTowardTheSpansTokenTotals(t *testing.T) {
	span := recordChatSpanForUsage(t, domain.Usage{
		PromptTokens:      200,
		InputAudioTokens:  800,
		CompletionTokens:  50,
		OutputAudioTokens: 250,
		TotalTokens:       1300,
	})

	input, ok := findIntAttr(span, "gen_ai.usage.input_tokens")
	require.True(t, ok)
	assert.EqualValues(t, 1000, input, "audio input folds back into the span total")

	output, ok := findIntAttr(span, "gen_ai.usage.output_tokens")
	require.True(t, ok)
	assert.EqualValues(t, 300, output, "audio output folds back into the span total")
}

func TestEmitter_AudioOnlyAnswer_IsNotDroppedAsAnEmptyProbe(t *testing.T) {
	// An audio-native model answers entirely in audio tokens. Reading the
	// completion total alone would see zero and drop a real answer.
	span := recordChatSpanForUsage(t, domain.Usage{
		PromptTokens:      0,
		InputAudioTokens:  800,
		CompletionTokens:  0,
		OutputAudioTokens: 250,
	})

	assert.False(t, hasDropMarker(span), "an audio answer is not an empty probe")
}

func TestEmitter_EmptyChatProbe_IsStillDropped(t *testing.T) {
	span := recordChatSpanForUsage(t, domain.Usage{PromptTokens: 3})

	assert.True(t, hasDropMarker(span), "a chat probe with no output still drops")
}
