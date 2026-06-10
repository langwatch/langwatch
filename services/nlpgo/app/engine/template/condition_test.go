package template

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestEvaluateCondition(t *testing.T) {
	t.Run("string comparisons", func(t *testing.T) {
		got, err := EvaluateCondition(`context != ""`, map[string]any{"context": "tool output"})
		require.NoError(t, err)
		assert.True(t, got)

		got, err = EvaluateCondition(`context != ""`, map[string]any{"context": ""})
		require.NoError(t, err)
		assert.False(t, got)
	})

	t.Run("numeric comparison", func(t *testing.T) {
		got, err := EvaluateCondition(`score > 0.5`, map[string]any{"score": 0.9})
		require.NoError(t, err)
		assert.True(t, got)

		got, err = EvaluateCondition(`score > 0.5`, map[string]any{"score": 0.2})
		require.NoError(t, err)
		assert.False(t, got)
	})

	t.Run("boolean input", func(t *testing.T) {
		got, err := EvaluateCondition(`tool_called`, map[string]any{"tool_called": true})
		require.NoError(t, err)
		assert.True(t, got)

		got, err = EvaluateCondition(`tool_called`, map[string]any{"tool_called": false})
		require.NoError(t, err)
		assert.False(t, got)
	})

	t.Run("and/or combinators", func(t *testing.T) {
		inputs := map[string]any{"a": "x", "b": ""}
		got, err := EvaluateCondition(`a != "" and b != ""`, inputs)
		require.NoError(t, err)
		assert.False(t, got)

		got, err = EvaluateCondition(`a != "" or b != ""`, inputs)
		require.NoError(t, err)
		assert.True(t, got)
	})

	t.Run("contains operator", func(t *testing.T) {
		got, err := EvaluateCondition(`label contains "relevant"`, map[string]any{"label": "very relevant"})
		require.NoError(t, err)
		assert.True(t, got)
	})

	t.Run("dotted access resolves on the root input", func(t *testing.T) {
		got, err := EvaluateCondition(`payload.kind == "tool"`, map[string]any{
			"payload": map[string]any{"kind": "tool"},
		})
		require.NoError(t, err)
		assert.True(t, got)
	})

	t.Run("words inside string literals are not input references", func(t *testing.T) {
		got, err := EvaluateCondition(`label == "not relevant"`, map[string]any{"label": "not relevant"})
		require.NoError(t, err)
		assert.True(t, got)
	})

	t.Run("undefined input errors instead of silently passing", func(t *testing.T) {
		// Liquid would treat the unknown variable as nil and evaluate
		// `nil != ""` to true — the gating condition must fail loudly.
		_, err := EvaluateCondition(`tool_called == true`, map[string]any{"context": "x"})
		require.Error(t, err)
		assert.Contains(t, err.Error(), "tool_called")
	})

	t.Run("empty condition errors", func(t *testing.T) {
		_, err := EvaluateCondition("  ", map[string]any{})
		require.Error(t, err)
	})

	t.Run("malformed condition errors", func(t *testing.T) {
		_, err := EvaluateCondition(`context !=`, map[string]any{"context": "x"})
		require.Error(t, err)
	})
}
