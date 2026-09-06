package langwatch

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPointerHelpers(t *testing.T) {
	t.Run("Int returns a pointer to the value", func(t *testing.T) {
		p := Int(42)
		require.NotNil(t, p)
		assert.Equal(t, 42, *p)
	})

	t.Run("Float64 returns a pointer to the value", func(t *testing.T) {
		p := Float64(0.125)
		require.NotNil(t, p)
		assert.Equal(t, 0.125, *p)
	})

	t.Run("Bool returns a pointer to the value", func(t *testing.T) {
		p := Bool(true)
		require.NotNil(t, p)
		assert.True(t, *p)
	})
}

func TestSpanMetricsMarshalling(t *testing.T) {
	t.Run("a fully populated SpanMetrics marshals to bare snake_case", func(t *testing.T) {
		m := SpanMetrics{
			TokensEstimated: Bool(true),
			Cost:            Float64(0.0125),
		}

		raw, err := json.Marshal(m)
		require.NoError(t, err)

		var got map[string]any
		require.NoError(t, json.Unmarshal(raw, &got))

		assert.Equal(t, true, got["tokens_estimated"])
		assert.EqualValues(t, 0.0125, got["cost"])
		// Token counts are no longer carried by SpanMetrics — they are emitted
		// via gen_ai.usage.* (see GenAIUsage).
		assert.NotContains(t, got, "prompt_tokens")
		assert.NotContains(t, got, "completion_tokens")
		assert.NotContains(t, got, "cache_read_input_tokens")
		assert.NotContains(t, got, "cache_creation_input_tokens")
	})

	t.Run("an empty SpanMetrics omits every field", func(t *testing.T) {
		raw, err := json.Marshal(SpanMetrics{})
		require.NoError(t, err)
		// All fields are pointers with omitempty, so an empty struct is {}.
		assert.JSONEq(t, `{}`, string(raw))
	})

	t.Run("a zero-valued field is still emitted when its pointer is set", func(t *testing.T) {
		// omitempty on a non-nil pointer keeps the field even when the pointee is
		// the zero value — distinguishing "0 cost" from "unset".
		raw, err := json.Marshal(SpanMetrics{Cost: Float64(0)})
		require.NoError(t, err)

		var got map[string]any
		require.NoError(t, json.Unmarshal(raw, &got))
		require.Contains(t, got, "cost")
		assert.EqualValues(t, 0, got["cost"])
		assert.NotContains(t, got, "tokens_estimated")
	})
}
