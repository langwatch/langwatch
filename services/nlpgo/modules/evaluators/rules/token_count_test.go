package rules

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Counts from litellm.encode (litellm's default cl100k_base), for OpenAI and Anthropic names.
func TestTokenCounterMatchesLitellmEncode(t *testing.T) {
	counter, err := NewTokenCounter()
	require.NoError(t, err)
	for text, want := range map[string]int{
		"hello world": 2,
		"İstanbul Généralisation running 🚀": 10,
		"def f(x):\n    return x**2  # 数学":  13,
		"":                                  0,
	} {
		assert.Equal(t, want, counter.Count("gpt-4o-mini", text), text)
		assert.Equal(t, want, counter.Count("anthropic/claude-sonnet-4-5", text), text)
	}
}
