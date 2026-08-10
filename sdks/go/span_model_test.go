package langwatch

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/attribute"
)

func TestSetTypeAndModels(t *testing.T) {
	t.Run("type and model setters write bare semantic-convention values", func(t *testing.T) {
		attrs := recordSpan(t, func(s *Span) {
			s.SetType(SpanTypeRAG).
				SetRequestModel("gpt-5-mini").
				SetResponseModel("gpt-5-mini-2025").
				SetGenAIProvider("openai")
		})
		assert.Equal(t, "rag", attrs[AttributeLangWatchSpanType].AsString())
		assert.Equal(t, "gpt-5-mini", attrs["gen_ai.request.model"].AsString())
		assert.Equal(t, "gpt-5-mini-2025", attrs["gen_ai.response.model"].AsString())
		assert.Equal(t, "openai", attrs["gen_ai.provider.name"].AsString())
	})
}

func TestSetParams(t *testing.T) {
	t.Run("params are recorded as a bare json object", func(t *testing.T) {
		attrs := recordSpan(t, func(s *Span) {
			s.SetParams(map[string]any{"temperature": 0.7, "stop": []string{"\n"}})
		})
		raw, ok := attrs[AttributeLangWatchParams]
		require.True(t, ok)

		var m map[string]any
		require.NoError(t, json.Unmarshal([]byte(raw.AsString()), &m))
		// Bare object — NOT wrapped in a {"type":...,"value":...} envelope.
		assert.NotContains(t, m, "type")
		assert.NotContains(t, m, "value")
		assert.EqualValues(t, 0.7, m["temperature"])
	})
}

func TestSetSelectedPromptOmitsZeroVersion(t *testing.T) {
	t.Run("a zero version number is omitted", func(t *testing.T) {
		attrs := recordSpan(t, func(s *Span) {
			s.SetSelectedPrompt(SelectedPrompt{ID: "prompt-1"})
		})
		assert.Equal(t, "prompt-1", attrs[AttributeLangWatchPromptSelectedID].AsString())
		assert.Equal(t, "prompt-1", attrs[AttributeLangWatchPromptID].AsString())
		_, hasVersionNumber := attrs[AttributeLangWatchPromptVersionNumber]
		assert.False(t, hasVersionNumber, "a zero VersionNumber must not be emitted")
		_, hasVersionID := attrs[AttributeLangWatchPromptVersionID]
		assert.False(t, hasVersionID, "an empty VersionID must not be emitted")
	})

	t.Run("an empty ID is omitted while the version fields still land", func(t *testing.T) {
		attrs := recordSpan(t, func(s *Span) {
			s.SetSelectedPrompt(SelectedPrompt{VersionID: "ver-1", VersionNumber: 6})
		})
		_, hasSelectedID := attrs[AttributeLangWatchPromptSelectedID]
		assert.False(t, hasSelectedID, "an empty ID must not be emitted")
		_, hasPromptID := attrs[AttributeLangWatchPromptID]
		assert.False(t, hasPromptID, "an empty ID must not be emitted")
		assert.Equal(t, "ver-1", attrs[AttributeLangWatchPromptVersionID].AsString())
		assert.EqualValues(t, 6, attrs[AttributeLangWatchPromptVersionNumber].AsInt64())
	})

	t.Run("a fully zero SelectedPrompt writes nothing", func(t *testing.T) {
		attrs := recordSpan(t, func(s *Span) {
			s.SetSelectedPrompt(SelectedPrompt{})
		})
		for _, key := range []attribute.Key{
			AttributeLangWatchPromptSelectedID,
			AttributeLangWatchPromptID,
			AttributeLangWatchPromptVersionID,
			AttributeLangWatchPromptVersionNumber,
		} {
			_, has := attrs[key]
			assert.Falsef(t, has, "%s must not be emitted", key)
		}
	})
}

func TestSetSelectedPrompt(t *testing.T) {
	t.Run("it sets the prompt identity attributes", func(t *testing.T) {
		attrs := recordSpan(t, func(s *Span) {
			s.SetSelectedPrompt(SelectedPrompt{ID: "prompt-1", VersionID: "ver-1", VersionNumber: 6})
		})
		assert.Equal(t, "prompt-1", attrs[AttributeLangWatchPromptSelectedID].AsString())
		assert.Equal(t, "prompt-1", attrs[AttributeLangWatchPromptID].AsString())
		assert.Equal(t, "ver-1", attrs[AttributeLangWatchPromptVersionID].AsString())
		assert.EqualValues(t, 6, attrs[AttributeLangWatchPromptVersionNumber].AsInt64())
	})
}
