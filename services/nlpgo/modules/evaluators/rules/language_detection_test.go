package rules

import (
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/contract"
)

func fixedDetector(byText map[string][]LanguageConfidence) DetectLanguages {
	return func(text string) []LanguageConfidence { return byText[text] }
}

func TestLanguageDetectionFollowsThePythonEvaluator(t *testing.T) {
	input, output := "one two three four five six seven", "un deux trois quatre cinq six sept"
	detect := fixedDetector(map[string][]LanguageConfidence{
		input:  {{"EN", 0.6}, {"FR", 0.3}, {"DE", 0.1}},
		output: {{"FR", 0.7}, {"EN", 0.7}, {"ES", 0.2}},
	})
	entry := contract.Entry{Input: &input, Output: &output}
	fr := "FR"

	verdict := LanguageDetection(DefaultLinguaLanguageDetectionSettings(), entry, detect)
	assert.Equal(t, LanguageDetectionVerdict{
		Passed:  true,
		Label:   "EN",
		Score:   2,
		Details: "Input languages detected: EN, FR. Output languages detected: FR, EN",
		Input:   []LanguageConfidence{{"EN", 0.6}, {"FR", 0.3}},
		Output:  []LanguageConfidence{{"FR", 0.7}, {"EN", 0.7}},
	}, verdict)

	settings := LinguaLanguageDetectionSettings{CheckFor: checkOutputMatchesLanguage, ExpectedLanguage: &fr, MinWords: 7, Threshold: 0.5}
	verdict = LanguageDetection(settings, entry, detect)
	assert.Equal(t, "FR", verdict.Label, "the first of equal confidences")
	assert.Equal(t, "Languages detected: FR, EN", verdict.Details)
	assert.Nil(t, verdict.Input)

	settings.Threshold = 0.9
	verdict = LanguageDetection(settings, entry, detect)
	assert.Equal(t, skippedLanguageDetection("Skipped because no language could be detected on the output with a confidence higher than 0.9"), verdict)
}

func TestLanguageDetectionWordGateCountsLikePython(t *testing.T) {
	assert.Equal(t, 1, pythonWordCount(""))
	assert.Equal(t, 3, pythonWordCount("a  b"))
	assert.Equal(t, 5, pythonWordCount("안녕하세요 여러분"), "25 utf-8 bytes // 5")
	entry := contract.Entry{Output: new(string)}
	verdict := LanguageDetection(DefaultLinguaLanguageDetectionSettings(), entry, fixedDetector(nil))
	assert.Equal(t, skippedLanguageDetection("Skipped because the input has less than 7 words"), verdict)
}
