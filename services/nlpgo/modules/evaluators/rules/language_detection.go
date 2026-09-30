package rules

import (
	"fmt"
	"slices"
	"strings"

	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/contract"
)

// LanguageConfidence is one language's confidence, as lingua reports it.
type LanguageConfidence struct {
	Language string // ISO 639-1, upper case
	Value    float64
}

// DetectLanguages returns every language's confidence, most confident first.
type DetectLanguages func(text string) []LanguageConfidence

// LanguageDetectionVerdict is lingua/language_detection's answer. A skipped
// verdict carries only Details; Input is nil for output_matches_language.
type LanguageDetectionVerdict struct {
	Skipped bool
	Passed  bool
	Label   string
	Score   float64
	Details string
	Input   []LanguageConfidence
	Output  []LanguageConfidence
}

const (
	checkInputMatchesOutput    = "input_matches_output"
	checkOutputMatchesLanguage = "output_matches_language"
)

// LanguageDetection is langevals_lingua's LinguaLanguageDetectionEvaluator:
// a word-count gate, then the languages above the threshold on the output
// (and the input, unless only the output's language is checked).
func LanguageDetection(settings LinguaLanguageDetectionSettings, entry contract.Entry, detect DetectLanguages) LanguageDetectionVerdict {
	input, output := "", ""
	if entry.Input != nil {
		input = *entry.Input
	}
	if entry.Output != nil {
		output = *entry.Output
	}
	if settings.CheckFor == checkInputMatchesOutput && pythonWordCount(input) < settings.MinWords {
		return skippedLanguageDetection(fmt.Sprintf("Skipped because the input has less than %d words", settings.MinWords))
	}
	if pythonWordCount(output) < settings.MinWords {
		return skippedLanguageDetection(fmt.Sprintf("Skipped because the output has less than %d words", settings.MinWords))
	}
	outputLanguages := confidentLanguages(detect(output), settings.Threshold)
	if len(outputLanguages) == 0 {
		return skippedLanguageDetection("Skipped because no language could be detected on the output with a confidence higher than " + pyFloatRepr(settings.Threshold))
	}
	if settings.CheckFor == checkOutputMatchesLanguage {
		return outputLanguageVerdict(settings, outputLanguages)
	}
	inputLanguages := confidentLanguages(detect(input), settings.Threshold)
	if len(inputLanguages) == 0 {
		return skippedLanguageDetection("Skipped because no language could be detected on the input with a confidence higher than " + pyFloatRepr(settings.Threshold))
	}
	return inputMatchesOutputVerdict(settings, inputLanguages, outputLanguages)
}

func outputLanguageVerdict(settings LinguaLanguageDetectionSettings, output []LanguageConfidence) LanguageDetectionVerdict {
	return LanguageDetectionVerdict{
		Passed:  settings.ExpectedLanguage == nil || hasLanguage(output, *settings.ExpectedLanguage),
		Label:   mostConfident(output),
		Score:   float64(len(output)),
		Details: "Languages detected: " + languageList(output),
		Output:  output,
	}
}

func inputMatchesOutputVerdict(settings LinguaLanguageDetectionSettings, input, output []LanguageConfidence) LanguageDetectionVerdict {
	passed := slices.ContainsFunc(output, func(c LanguageConfidence) bool { return hasLanguage(input, c.Language) })
	details := ""
	if !passed {
		details = "Input and output languages do not match. "
	}
	if expected := settings.ExpectedLanguage; expected != nil {
		passed = passed && hasLanguage(output, *expected)
		if !passed {
			details = fmt.Sprintf("Input and output do not match the expected language: %s. ", *expected)
		}
	}
	union := len(input)
	for _, c := range output {
		if !hasLanguage(input, c.Language) {
			union++
		}
	}
	return LanguageDetectionVerdict{
		Passed:  passed,
		Label:   mostConfident(input),
		Score:   float64(union),
		Details: fmt.Sprintf("%sInput languages detected: %s. Output languages detected: %s", details, languageList(input), languageList(output)),
		Input:   input,
		Output:  output,
	}
}

func skippedLanguageDetection(details string) LanguageDetectionVerdict {
	return LanguageDetectionVerdict{Skipped: true, Details: details}
}

// pythonWordCount is max(len(s.split(" ")), len(s.encode("utf-8")) // 5).
func pythonWordCount(s string) int {
	return max(strings.Count(s, " ")+1, len(s)/5)
}

// confidentLanguages keeps the languages strictly above the threshold, in order.
func confidentLanguages(all []LanguageConfidence, threshold float64) []LanguageConfidence {
	var kept []LanguageConfidence
	for _, c := range all {
		if c.Value > threshold {
			kept = append(kept, c)
		}
	}
	return kept
}

// mostConfident is the first language with the highest confidence, as
// Python's stable sorted(reverse=True)[0] picks it.
func mostConfident(languages []LanguageConfidence) string {
	best := languages[0]
	for _, c := range languages[1:] {
		if c.Value > best.Value {
			best = c
		}
	}
	return best.Language
}

func hasLanguage(languages []LanguageConfidence, language string) bool {
	return slices.ContainsFunc(languages, func(c LanguageConfidence) bool { return c.Language == language })
}

func languageList(languages []LanguageConfidence) string {
	names := make([]string, len(languages))
	for i, c := range languages {
		names[i] = c.Language
	}
	return strings.Join(names, ", ")
}
