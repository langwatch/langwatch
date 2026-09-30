package services

import (
	"context"

	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/contract"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/rules"
)

// BuiltinEvaluators pairs each definition with how it runs.
func BuiltinEvaluators() map[string]Evaluator {
	definitions := rules.Definitions()
	return map[string]Evaluator{
		"langevals/exact_match": {
			Definition: definitions["langevals/exact_match"],
			Prepare:    WithSettings(rules.ParseExactMatchSettings, scoreExactMatch),
		},
	}
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
