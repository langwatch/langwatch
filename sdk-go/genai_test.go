package langwatch

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"go.opentelemetry.io/otel/attribute"
)

func TestSetGenAIRequestParams(t *testing.T) {
	t.Run("it records only the set params under gen_ai.request.*", func(t *testing.T) {
		attrs := recordSpan(t, func(s *Span) {
			s.SetGenAIRequestParams(GenAIRequestParams{
				Temperature:     Float64(0.7),
				MaxTokens:       Int(256),
				StopSequences:   []string{"\n\n"},
				ReasoningEffort: "high",
			})
		})

		assert.InDelta(t, 0.7, attrs["gen_ai.request.temperature"].AsFloat64(), 1e-9)
		assert.EqualValues(t, 256, attrs["gen_ai.request.max_tokens"].AsInt64())
		assert.Equal(t, []string{"\n\n"}, attrs["gen_ai.request.stop_sequences"].AsStringSlice())
		assert.Equal(t, "high", attrs["gen_ai.request.reasoning_effort"].AsString())

		// Unset params are omitted.
		_, hasTopP := attrs[attribute.Key("gen_ai.request.top_p")]
		assert.False(t, hasTopP)
	})
}

func TestSetGenAIRequestParamsAllFields(t *testing.T) {
	t.Run("it records every supplied pointer field", func(t *testing.T) {
		attrs := recordSpan(t, func(s *Span) {
			s.SetGenAIRequestParams(GenAIRequestParams{
				Temperature:      Float64(0.5),
				TopP:             Float64(0.9),
				TopK:             Float64(40),
				MaxTokens:        Int(128),
				FrequencyPenalty: Float64(0.1),
				PresencePenalty:  Float64(0.2),
				Seed:             Int(7),
				ChoiceCount:      Int(2),
			})
		})

		assert.InDelta(t, 0.9, attrs["gen_ai.request.top_p"].AsFloat64(), 1e-9)
		assert.InDelta(t, 40, attrs["gen_ai.request.top_k"].AsFloat64(), 1e-9)
		assert.InDelta(t, 0.1, attrs["gen_ai.request.frequency_penalty"].AsFloat64(), 1e-9)
		assert.InDelta(t, 0.2, attrs["gen_ai.request.presence_penalty"].AsFloat64(), 1e-9)
		assert.EqualValues(t, 7, attrs["gen_ai.request.seed"].AsInt64())
		assert.EqualValues(t, 2, attrs["gen_ai.request.choice.count"].AsInt64())
	})

	t.Run("when nothing is set it records no attributes", func(t *testing.T) {
		attrs := recordSpan(t, func(s *Span) {
			s.SetGenAIRequestParams(GenAIRequestParams{})
		})
		for key := range attrs {
			assert.NotContains(t, string(key), "gen_ai.request.")
		}
	})
}

func TestSetGenAIUsage(t *testing.T) {
	t.Run("it records token usage under gen_ai.usage.*", func(t *testing.T) {
		attrs := recordSpan(t, func(s *Span) {
			s.SetGenAIUsage(GenAIUsage{
				InputTokens:       Int(120),
				OutputTokens:      Int(48),
				TotalTokens:       Int(168),
				CachedInputTokens: Int(64),
				ReasoningTokens:   Int(12),
			})
		})

		assert.EqualValues(t, 120, attrs["gen_ai.usage.input_tokens"].AsInt64())
		assert.EqualValues(t, 48, attrs["gen_ai.usage.output_tokens"].AsInt64())
		assert.EqualValues(t, 168, attrs["gen_ai.usage.total_tokens"].AsInt64())
		assert.EqualValues(t, 64, attrs["gen_ai.usage.cached_input_tokens"].AsInt64())
		assert.EqualValues(t, 12, attrs["gen_ai.usage.reasoning.output_tokens"].AsInt64())
	})

	t.Run("stream flag and time-to-first-chunk record the v1.41 response keys", func(t *testing.T) {
		attrs := recordSpan(t, func(s *Span) {
			s.SetGenAIRequestStream(true).SetGenAITimeToFirstChunk(0.123)
		})
		assert.Equal(t, true, attrs["gen_ai.request.stream"].AsBool())
		assert.InDelta(t, 0.123, attrs["gen_ai.response.time_to_first_chunk"].AsFloat64(), 1e-9)
	})

	t.Run("when nothing is set it records no usage attributes", func(t *testing.T) {
		attrs := recordSpan(t, func(s *Span) {
			s.SetGenAIUsage(GenAIUsage{})
		})
		for key := range attrs {
			assert.NotContains(t, string(key), "gen_ai.usage.")
		}
	})
}

func TestSetGenAIResponseFinishReasonsEmpty(t *testing.T) {
	t.Run("an empty finish-reason slice is a no-op", func(t *testing.T) {
		attrs := recordSpan(t, func(s *Span) {
			s.SetGenAIResponseFinishReasons()
		})
		_, ok := attrs[attribute.Key("gen_ai.response.finish_reasons")]
		assert.False(t, ok, "no finish reasons must mean no attribute")
	})
}

func TestSetGenAIOperationAndFinishReasons(t *testing.T) {
	t.Run("it records operation and finish reasons", func(t *testing.T) {
		attrs := recordSpan(t, func(s *Span) {
			s.SetGenAIOperation("chat").
				SetGenAIResponseFinishReasons("stop", "length")
		})
		assert.Equal(t, "chat", attrs["gen_ai.operation.name"].AsString())
		assert.Equal(t, []string{"stop", "length"}, attrs["gen_ai.response.finish_reasons"].AsStringSlice())
	})
}

func TestSetGenAIProvider(t *testing.T) {
	t.Run("it records the provider name", func(t *testing.T) {
		attrs := recordSpan(t, func(s *Span) { s.SetGenAIProvider("openai") })
		assert.Equal(t, "openai", attrs["gen_ai.provider.name"].AsString())
	})
}
