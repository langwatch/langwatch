package services

import (
	"context"
	"encoding/json"

	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/contract"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/rules"
	lingua "github.com/langwatch/langwatch/services/third_party/lingua-go"
)

// linguaPrepares is lingua/language_detection once nlpgo has loaded the models
// (NLPGO_LINGUA_MODELS): without them the slug answers evaluator_not_found,
// which TS raises as EvaluatorNotFoundError; an engine override keeps it on
// langevals. The detector is built once, shared and safe for concurrent use.
func linguaPrepares() map[string]func(json.RawMessage) (Score, error) {
	if !lingua.ModelsAvailable() {
		return map[string]func(json.RawMessage) (Score, error){}
	}
	detect := linguaDetect(lingua.NewLanguageDetectorBuilder().FromAllLanguages().WithPreloadedLanguageModels().Build())
	return map[string]func(json.RawMessage) (Score, error){
		"lingua/language_detection": WithSettings(rules.ParseLinguaLanguageDetectionSettings, languageDetectionScorer(detect)),
	}
}

// linguaDetect adapts the detector to rules.DetectLanguages, most confident first.
func linguaDetect(detector lingua.LanguageDetector) rules.DetectLanguages {
	return func(text string) []rules.LanguageConfidence {
		values := detector.ComputeLanguageConfidenceValues(text)
		confidences := make([]rules.LanguageConfidence, len(values))
		for i, value := range values {
			confidences[i] = rules.LanguageConfidence{Language: value.Language().IsoCode639_1().String(), Value: value.Value()}
		}
		return confidences
	}
}

// linguaRawResponse is langevals' LinguaLanguageDetectionRawResponse; input
// is null for output_matches_language.
type linguaRawResponse struct {
	Input  map[string]float64 `json:"input"`
	Output map[string]float64 `json:"output"`
}

func languageDetectionScorer(detect rules.DetectLanguages) func(context.Context, rules.LinguaLanguageDetectionSettings, EntryRun) (contract.Result, error) {
	return func(_ context.Context, settings rules.LinguaLanguageDetectionSettings, in EntryRun) (contract.Result, error) {
		verdict := rules.LanguageDetection(settings, in.Entry, detect)
		if verdict.Skipped {
			return contract.Result{Status: contract.StatusSkipped, Details: &verdict.Details}, nil
		}
		raw, err := json.Marshal(linguaRawResponse{Input: confidenceMap(verdict.Input), Output: confidenceMap(verdict.Output)})
		if err != nil {
			return contract.Result{}, err
		}
		return contract.Result{
			Status:      contract.StatusProcessed,
			Score:       &verdict.Score,
			Passed:      &verdict.Passed,
			Label:       &verdict.Label,
			Details:     &verdict.Details,
			RawResponse: raw,
		}, nil
	}
}

func confidenceMap(confidences []rules.LanguageConfidence) map[string]float64 {
	if confidences == nil {
		return nil
	}
	m := make(map[string]float64, len(confidences))
	for _, c := range confidences {
		m[c.Language] = c.Value
	}
	return m
}
