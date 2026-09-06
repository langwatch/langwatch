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
// prompt and completion totals so every consumer prices them at the audio
// rate, and the span states them under their own attributes, disjoint from
// the text totals exactly as the cache buckets are. An audio-native answer
// is still not mistaken for an empty one.

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

/** @scenario A span states its audio tokens apart from its text tokens */
func TestEmitter_AudioTokens_AreStatedApartFromTheTextTotals(t *testing.T) {
	span := recordChatSpanForUsage(t, domain.Usage{
		PromptTokens:      200,
		InputAudioTokens:  800,
		CompletionTokens:  50,
		OutputAudioTokens: 250,
		TotalTokens:       1300,
	})

	input, ok := findIntAttr(span, "gen_ai.usage.input_tokens")
	require.True(t, ok)
	assert.EqualValues(t, 200, input, "the text total excludes audio input")

	output, ok := findIntAttr(span, "gen_ai.usage.output_tokens")
	require.True(t, ok)
	assert.EqualValues(t, 50, output, "the text total excludes audio output")

	inputAudio, ok := findIntAttr(span, AttrGenAIUsageInputAudioTokens)
	require.True(t, ok)
	assert.EqualValues(t, 800, inputAudio)

	outputAudio, ok := findIntAttr(span, AttrGenAIUsageOutputAudioTokens)
	require.True(t, ok)
	assert.EqualValues(t, 250, outputAudio)

	total, ok := findIntAttr(span, string(attrTotalUsage))
	require.True(t, ok)
	assert.EqualValues(t, 1300, total, "the provider's total still counts every token")
}

/** @scenario A span states its audio tokens apart from its text tokens */
func TestEmitter_NoAudioTokens_LeavesTheAudioAttributesOff(t *testing.T) {
	span := recordChatSpanForUsage(t, domain.Usage{
		PromptTokens:     200,
		CompletionTokens: 50,
		TotalTokens:      250,
	})

	_, hasInput := findIntAttr(span, AttrGenAIUsageInputAudioTokens)
	assert.False(t, hasInput, "a text-only call states no audio input")

	_, hasOutput := findIntAttr(span, AttrGenAIUsageOutputAudioTokens)
	assert.False(t, hasOutput, "a text-only call states no audio output")
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
