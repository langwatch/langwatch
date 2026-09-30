package services

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/contract"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/rules"
)

// ragasTextPrepares are the ragas metrics that call no model: no cost, no
// token check, never skipped.
func ragasTextPrepares() map[string]func(json.RawMessage) (Score, error) {
	return map[string]func(json.RawMessage) (Score, error){
		"ragas/bleu_score":        WithSettings(rules.ParseNoSettings, scoreRagasBLEU),
		"ragas/rouge_score":       WithSettings(rules.ParseRagasROUGEScoreSettings, scoreRagasROUGE),
		"ragas/context_precision": WithSettings(rules.ParseRagasContextDistanceSettings, contextScorer(rules.ContextPrecision)),
		"ragas/context_recall":    WithSettings(rules.ParseRagasContextDistanceSettings, contextScorer(rules.ContextRecall)),
		"ragas/context_f1":        WithSettings(rules.ParseRagasContextDistanceSettings, contextScorer(rules.ContextF1)),
	}
}

func scoreRagasBLEU(_ context.Context, _ rules.NoSettings, in EntryRun) (contract.Result, error) {
	return scored(rules.BLEU(*in.Entry.Output, *in.Entry.ExpectedOutput), ""), nil
}

func scoreRagasROUGE(_ context.Context, settings rules.RagasROUGEScoreSettings, in EntryRun) (contract.Result, error) {
	return scored(rules.ROUGE(*in.Entry.ExpectedOutput, *in.Entry.Output, settings), ""), nil
}

type contextMetric func(retrieved, expected []string, measure string) (float64, string)

// contextScorer scores one of the context metrics over the entry's contexts
// (retrieved) and expected_contexts.
func contextScorer(metric contextMetric) func(context.Context, rules.RagasContextDistanceSettings, EntryRun) (contract.Result, error) {
	return func(_ context.Context, settings rules.RagasContextDistanceSettings, in EntryRun) (contract.Result, error) {
		var retrieved, expected []string
		if json.Unmarshal(in.Entry.Contexts, &retrieved) != nil || json.Unmarshal(in.Entry.ExpectedContexts, &expected) != nil {
			return contract.Result{}, errors.New("contexts and expected_contexts must be lists of strings")
		}
		return scored(metric(retrieved, expected, settings.DistanceMeasure)), nil
	}
}

// scored is a processed result; empty details are none.
func scored(score float64, details string) contract.Result {
	result := contract.Result{Status: contract.StatusProcessed, Score: &score}
	if details != "" {
		result.Details = &details
	}
	return result
}
