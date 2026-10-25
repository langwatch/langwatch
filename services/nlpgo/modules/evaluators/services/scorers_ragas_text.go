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

func scoreRagasROUGE(ctx context.Context, settings rules.RagasROUGEScoreSettings, in EntryRun) (contract.Result, error) {
	score, err := rules.ROUGE(ctx, rules.ROUGETexts{Reference: *in.Entry.ExpectedOutput, Response: *in.Entry.Output}, settings)
	return comparisonResult(score, "", err)
}

type contextMetric func(ctx context.Context, retrieved, expected []string, measure string) (float64, string, error)

// contextScorer scores one of the context metrics over the entry's contexts
// (retrieved) and expected_contexts.
func contextScorer(metric contextMetric) func(context.Context, rules.RagasContextDistanceSettings, EntryRun) (contract.Result, error) {
	return func(ctx context.Context, settings rules.RagasContextDistanceSettings, in EntryRun) (contract.Result, error) {
		var retrieved, expected []string
		if json.Unmarshal(in.Entry.Contexts, &retrieved) != nil || json.Unmarshal(in.Entry.ExpectedContexts, &expected) != nil {
			return contract.Result{}, errors.New("contexts and expected_contexts must be lists of strings")
		}
		return comparisonResult(metric(ctx, retrieved, expected, settings.DistanceMeasure))
	}
}

// comparisonResult is a scored result, a ValidationError entry for texts too
// long to compare, or the error (the deadline's included) that ended it.
func comparisonResult(score float64, details string, err error) (contract.Result, error) {
	switch {
	case errors.Is(err, rules.ErrComparisonTooLarge):
		return errorResult("ValidationError", err.Error()), nil
	case err != nil:
		return contract.Result{}, err
	}
	return scored(score, details), nil
}

// scored is a processed result; empty details are none.
func scored(score float64, details string) contract.Result {
	result := contract.Result{Status: contract.StatusProcessed, Score: &score}
	if details != "" {
		result.Details = &details
	}
	return result
}
