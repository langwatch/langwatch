package langwatch

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/attribute"
)

func TestSetTimestampsWithFirstToken(t *testing.T) {
	t.Run("a first-token timestamp pointer is recorded when set", func(t *testing.T) {
		attrs := recordSpan(t, func(s *Span) {
			ft := int64(1500)
			s.SetTimestamps(SpanTimestamps{StartedAtUnix: 1000, FirstTokenAtUnix: &ft, FinishedAtUnix: 2000})
		})
		var m map[string]any
		require.NoError(t, json.Unmarshal([]byte(attrs[AttributeLangWatchTimestamps].AsString()), &m))
		assert.EqualValues(t, 1000, m["started_at"])
		assert.EqualValues(t, 1500, m["first_token_at"])
		assert.EqualValues(t, 2000, m["finished_at"])
	})

	t.Run("an unset first-token timestamp is omitted", func(t *testing.T) {
		attrs := recordSpan(t, func(s *Span) {
			s.SetTimestamps(SpanTimestamps{StartedAtUnix: 1000, FinishedAtUnix: 2000})
		})
		var m map[string]any
		require.NoError(t, json.Unmarshal([]byte(attrs[AttributeLangWatchTimestamps].AsString()), &m))
		assert.NotContains(t, m, "first_token_at")
	})
}

func TestSetRAGContextSingular(t *testing.T) {
	t.Run("a single context is wrapped into the bare array", func(t *testing.T) {
		attrs := recordSpan(t, func(s *Span) {
			s.SetRAGContext(SpanRAGContextChunk{DocumentID: "doc-1", Content: "passage"})
		})
		raw, ok := attrs[AttributeLangWatchRAGContexts]
		require.True(t, ok)

		var chunks []map[string]any
		require.NoError(t, json.Unmarshal([]byte(raw.AsString()), &chunks))
		require.Len(t, chunks, 1)
		assert.Equal(t, "doc-1", chunks[0]["document_id"])
		assert.Equal(t, "passage", chunks[0]["content"])
	})
}

// @scenario "Cost is recorded on the span metrics"
func TestSetMetrics(t *testing.T) {
	t.Run("metrics are recorded as a bare snake_case object", func(t *testing.T) {
		attrs := recordSpan(t, func(s *Span) {
			s.SetMetrics(SpanMetrics{
				Cost:            Float64(0.0125),
				TokensEstimated: Bool(true),
			})
		})

		raw, ok := attrs[AttributeLangWatchMetrics]
		require.True(t, ok)

		var m map[string]any
		require.NoError(t, json.Unmarshal([]byte(raw.AsString()), &m))

		// Bare object — NOT wrapped in a {"type":"json","value":...} envelope.
		assert.NotContains(t, m, "type")
		assert.NotContains(t, m, "value")
		assert.EqualValues(t, 0.0125, m["cost"])
		assert.Equal(t, true, m["tokens_estimated"])
		// Token counts are no longer carried by langwatch.metrics — they live in
		// gen_ai.usage.* (see SetGenAIUsage).
		assert.NotContains(t, m, "prompt_tokens")
		assert.NotContains(t, m, "completion_tokens")
	})
}

// @scenario "Retrieved chunks populate the span contexts"
func TestSetRAGContexts(t *testing.T) {
	t.Run("contexts use the canonical key and a bare array", func(t *testing.T) {
		attrs := recordSpan(t, func(s *Span) {
			s.SetRAGContexts([]SpanRAGContextChunk{
				{DocumentID: "doc-1", ChunkID: "c-1", Content: "passage"},
			})
		})

		raw, ok := attrs[AttributeLangWatchRAGContexts]
		require.True(t, ok, "must emit langwatch.rag.contexts")
		assert.Equal(t, attribute.Key("langwatch.rag.contexts"), AttributeLangWatchRAGContexts)

		// The legacy/unrecognised key must NOT be emitted.
		_, legacy := attrs[attribute.Key("langwatch.contexts")]
		assert.False(t, legacy, "must not emit the unrecognised langwatch.contexts key")

		// Bare array, not a {"type":...,"value":...} envelope.
		var chunks []map[string]any
		require.NoError(t, json.Unmarshal([]byte(raw.AsString()), &chunks))
		require.Len(t, chunks, 1)
		assert.Equal(t, "doc-1", chunks[0]["document_id"])
		assert.Equal(t, "passage", chunks[0]["content"])
	})
}

func TestSetTimestamps(t *testing.T) {
	t.Run("timestamps are recorded as a bare object", func(t *testing.T) {
		attrs := recordSpan(t, func(s *Span) {
			s.SetTimestamps(SpanTimestamps{StartedAtUnix: 1000, FinishedAtUnix: 2000})
		})
		var m map[string]any
		require.NoError(t, json.Unmarshal([]byte(attrs[AttributeLangWatchTimestamps].AsString()), &m))
		assert.NotContains(t, m, "type")
		assert.EqualValues(t, 1000, m["started_at"])
		assert.EqualValues(t, 2000, m["finished_at"])
	})
}

func TestFluentChaining(t *testing.T) {
	t.Run("LangWatch setters return the span for chaining", func(t *testing.T) {
		attrs := recordSpan(t, func(s *Span) {
			s.SetType(SpanTypeLLM).
				SetRequestModel("gpt-5-mini").
				SetInput("hi").
				SetOutput("yo")
		})
		assert.Equal(t, "llm", attrs[AttributeLangWatchSpanType].AsString())
		assert.Equal(t, "gpt-5-mini", attrs["gen_ai.request.model"].AsString())
		assert.Contains(t, attrs, AttributeLangWatchInput)
		assert.Contains(t, attrs, AttributeLangWatchOutput)
	})
}
