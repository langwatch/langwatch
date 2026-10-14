package rules

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// @scenario "Settings a request leaves out take their defaults"
func TestParseSettingsKeepsDefaultsForMissingFields(t *testing.T) {
	settings, err := ParseCustomLLMCategorySettings(json.RawMessage(`{"prompt":"Sort it","unknown":1}`))

	require.NoError(t, err)
	want := DefaultCustomLLMCategorySettings()
	want.Prompt = "Sort it"
	assert.Equal(t, want, settings)
}

func TestParseSettingsKeepsNestedDefaults(t *testing.T) {
	moderation, err := ParseOpenAIModerationSettings(json.RawMessage(`{"categories":{"hate":false}}`))
	require.NoError(t, err)
	want := DefaultOpenAIModerationSettings()
	want.Categories.Hate = false
	assert.Equal(t, want, moderation)

	basic, err := ParseCustomBasicSettings(json.RawMessage(`{"rules":[{"rule":"contains","value":"refund"}]}`))
	require.NoError(t, err)
	assert.Equal(t, []CustomBasicRule{{Field: "output", Rule: "contains", Value: "refund"}}, basic.Rules)
}

func TestParseSettingsTreatsAbsentSettingsAsDefaults(t *testing.T) {
	for _, raw := range []string{"", "null", "{}"} {
		settings, err := ParseSettings(json.RawMessage(raw), DefaultSelectBestCompareSettings())
		require.NoError(t, err, raw)
		assert.Equal(t, DefaultSelectBestCompareSettings(), settings, raw)
	}
}

// @scenario "Settings of the wrong type are refused"
func TestParseSettingsRefusesAWrongType(t *testing.T) {
	for _, raw := range []string{
		`{"max_tokens":"lots"}`,
		`{"max_tokens":12.5}`,
		`{"autodetect_dont_know":"yes"}`,
		`{"model":["openai/gpt-5-mini"]}`,
		`["model"]`,
	} {
		_, err := ParseRagasFaithfulnessSettings(json.RawMessage(raw))
		require.Error(t, err, raw)
	}
	_, err := ParseSettings(json.RawMessage(`{"max_tokens":"lots"}`), DefaultLLMEvaluatorSettings())
	require.EqualError(t, err, "settings.max_tokens has the wrong type")
}

// @scenario "A setting outside its allowed values is refused"
func TestParseSettingsRefusesAValueOutsideItsLiteralSet(t *testing.T) {
	_, err := ParseRagasFactualCorrectnessSettings(json.RawMessage(`{"mode":"median"}`))
	require.EqualError(t, err, "settings.mode is not one of its allowed values")

	for name, check := range map[string]func() error{
		"int literal": func() error {
			_, err := ParseAzureContentSafetySettings(json.RawMessage(`{"severity_threshold":9}`))
			return err
		},
		"optional": func() error {
			_, err := ParseLinguaLanguageDetectionSettings(json.RawMessage(`{"expected_language":"XX"}`))
			return err
		},
		"list of literal": func() error {
			_, err := ParsePairwiseCompareSettings(json.RawMessage(`{"include_metrics":["cost","tokens"]}`))
			return err
		},
		"list element": func() error {
			_, err := ParseCustomBasicSettings(json.RawMessage(`{"rules":[{"rule":"equals","value":"x"}]}`))
			return err
		},
	} {
		require.Error(t, check(), name)
	}

	language, err := ParseLinguaLanguageDetectionSettings(json.RawMessage(`{"expected_language":"NL"}`))
	require.NoError(t, err)
	require.NotNil(t, language.ExpectedLanguage)
	assert.Equal(t, "NL", *language.ExpectedLanguage)
}

func TestParseSettingsRefusesAListElementMissingARequiredField(t *testing.T) {
	_, err := ParseOffTopicSettings(json.RawMessage(`{"allowed_topics":[{"topic":"billing"}]}`))

	require.EqualError(t, err, "settings.allowed_topics[0].description is required")
}
