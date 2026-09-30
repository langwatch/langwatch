package services

import (
	"context"
	"encoding/json"
	"maps"

	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/contract"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/rules"
)

// BuiltinEvaluators pairs each ported evaluator's definition with how it
// runs. Keyed on the scorers, so a defined but unported evaluator stays
// evaluator_not_found.
func BuiltinEvaluators() map[string]Evaluator {
	prepares := map[string]func(json.RawMessage) (Score, error){
		"langevals/exact_match": WithSettings(rules.ParseExactMatchSettings, scoreExactMatch),
	}
	maps.Copy(prepares, langevalsRulesPrepares())
	maps.Copy(prepares, ragasTextPrepares())
	maps.Copy(prepares, ragasLLMPrepares())
	maps.Copy(prepares, vendorPrepares())
	maps.Copy(prepares, linguaPrepares())
	maps.Copy(prepares, piiPrepares())
	evaluators := make(map[string]Evaluator, len(prepares))
	definitions := rules.Definitions()
	for i := range definitions {
		if prepare, ok := prepares[definitions[i].Slug]; ok {
			evaluators[definitions[i].Slug] = Evaluator{Definition: definitions[i], Prepare: prepare}
		}
	}
	return evaluators
}

// scoreExactMatch scores with rules.ExactMatch; the required fields were
// checked before it runs.
func scoreExactMatch(_ context.Context, settings rules.ExactMatchSettings, in EntryRun) (contract.Result, error) {
	passed, details := rules.ExactMatch(*in.Entry.Output, *in.Entry.ExpectedOutput, settings)
	score := 0.0
	if passed {
		score = 1
	}
	return contract.Result{Status: contract.StatusProcessed, Score: &score, Passed: &passed, Details: &details}, nil
}
