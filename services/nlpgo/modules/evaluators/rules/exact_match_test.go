package rules

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The cases of services/langevals/evaluators/langevals/tests/test_exact_match.py.
func TestExactMatchMatchesThePythonEvaluator(t *testing.T) {
	defaults := DefaultExactMatchSettings()
	with := func(edit func(*ExactMatchSettings)) ExactMatchSettings {
		settings := DefaultExactMatchSettings()
		edit(&settings)
		return settings
	}
	cases := []struct {
		name             string
		output, expected string
		settings         ExactMatchSettings
		passed           bool
	}{
		{"identical", "What is the capital of France?", "What is the capital of France?", defaults, true},
		{"different", "What is the capital of France?", "What is the capital of the Netherlands?", defaults, false},
		{"case sensitive", "Hello World", "hello world", with(func(s *ExactMatchSettings) { s.CaseSensitive = true }), false},
		{"case insensitive", "Hello World", "hello world", with(func(s *ExactMatchSettings) { s.CaseSensitive = false }), true},
		{"trim whitespace", "  Hello World  ", "Hello World", with(func(s *ExactMatchSettings) { s.TrimWhitespace = true }), true},
		{"keep whitespace", "  Hello World  ", "Hello World", with(func(s *ExactMatchSettings) { s.TrimWhitespace = false }), false},
		{"remove punctuation", "Hello, World!", "Hello World", with(func(s *ExactMatchSettings) { s.RemovePunctuation = true }), true},
		{"keep punctuation", "Hello, World!", "Hello World", with(func(s *ExactMatchSettings) { s.RemovePunctuation = false }), false},
		{"combined", "  Hello, World!  ", "hello world", defaults, true},
		{"negative number", "-1", "1", defaults, false},
		{"true and 1", "true", "1", defaults, true},
		{"1 and true", "1", "true", defaults, true},
		{"true and true", "true", "true", defaults, true},
		{"false and 0", "false", "0", defaults, true},
		{"0 and false", "0", "false", defaults, true},
		{"false and false", "false", "false", defaults, true},
		{"1.0 and 1", "1.0", "1", defaults, true},
		{"1 and 1.0", "1", "1.0", defaults, true},
		{"true and 0", "true", "0", defaults, false},
		{"false and 1", "false", "1", defaults, false},
		{"2 and true", "2", "true", defaults, false},
		{"hello and true", "hello", "true", defaults, false},
		{"true and hello", "true", "hello", defaults, false},
		{"transform chain for text", "  Hello!  ", "hello", defaults, true},
		{"float short-circuit", "1.50", "1.5", defaults, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			passed, _ := ExactMatch(tc.output, tc.expected, tc.settings)
			assert.Equal(t, tc.passed, passed)
		})
	}
}

func TestExactMatchDetailsAreThePythonEvaluators(t *testing.T) {
	defaults := DefaultExactMatchSettings()

	_, details := ExactMatch("1.50", "1.5", defaults)
	assert.Equal(t, "1.50 == 1.5", details)

	_, details = ExactMatch("2", "3", defaults)
	assert.Equal(t, "Expected 2 to be equal to 3", details)

	_, details = ExactMatch("  Hello!  ", "hello", defaults)
	assert.Equal(t, "hello == hello", details)

	_, details = ExactMatch("Hello", "World", defaults)
	assert.Equal(t, "Expected:\n\t\"hello\"\n\nTo be exactly equal to:\n\t\"world\"", details)
}

func TestPyFloatFollowsPythonFloat(t *testing.T) {
	for _, text := range []string{" 1.5 ", "1_000", "-inf", "Infinity", "nan", "-NaN", "1e400", ".5", "5."} {
		_, ok := pyFloat(text)
		assert.True(t, ok, text)
	}
	for _, text := range []string{"", "0x10", "1__0", "_1", "1_", "--1", "1e", "hello", "0x1p-2"} {
		_, ok := pyFloat(text)
		assert.False(t, ok, text)
	}
}

func TestParseExactMatchSettingsRefusesNonBooleans(t *testing.T) {
	_, err := ParseExactMatchSettings([]byte(`{"case_sensitive":"yes"}`))
	require.Error(t, err)

	settings, err := ParseExactMatchSettings(nil)
	require.NoError(t, err)
	assert.Equal(t, DefaultExactMatchSettings(), settings)
}
