package services

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/contract"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/rules"
)

// langevalsRulesPrepares are the rule-based langevals evaluators, keyed on slug.
func langevalsRulesPrepares() map[string]func(json.RawMessage) (Score, error) {
	return map[string]func(json.RawMessage) (Score, error){
		"langevals/basic":                WithSettings(rules.ParseCustomBasicSettings, scoreBasic),
		"langevals/competitor_blocklist": WithSettings(rules.ParseCompetitorBlocklistSettings, scoreCompetitorBlocklist),
		"langevals/valid_format":         WithSettings(rules.ParseValidFormatSettings, scoreValidFormat),
	}
}

func scoreBasic(_ context.Context, settings rules.CustomBasicSettings, in EntryRun) (contract.Result, error) {
	passed, details, err := rules.Basic(settings, in.Entry.Input, in.Entry.Output)
	if err != nil {
		return contract.Result{}, err
	}
	return processed(passed, true, details), nil
}

func scoreCompetitorBlocklist(_ context.Context, settings rules.CompetitorBlocklistSettings, in EntryRun) (contract.Result, error) {
	mentions := rules.CompetitorBlocklist(settings, in.Entry.Input, in.Entry.Output)
	score := float64(len(mentions))
	passed := len(mentions) == 0
	result := contract.Result{Status: contract.StatusProcessed, Score: &score, Passed: &passed}
	if !passed {
		details := "Competitors mentioned: " + strings.Join(mentions, ", ")
		result.Details = &details
	}
	return result, nil
}

func scoreValidFormat(_ context.Context, settings rules.ValidFormatSettings, in EntryRun) (contract.Result, error) {
	if in.Entry.Output == nil || *in.Entry.Output == "" {
		details := "Output is empty"
		return contract.Result{Status: contract.StatusSkipped, Details: &details}, nil
	}
	verdict := rules.ValidFormat(*in.Entry.Output, settings)
	if verdict.ErrorType != "" {
		return contract.Result{Status: contract.StatusError, ErrorType: verdict.ErrorType, Details: &verdict.Details, Traceback: []string{}}, nil
	}
	return processed(verdict.Passed, !verdict.Unscored, verdict.Details), nil
}

// processed is a verdict scored 1 or 0 (or unscored), with details when set.
func processed(passed, scored bool, details string) contract.Result {
	result := contract.Result{Status: contract.StatusProcessed, Passed: &passed}
	if scored {
		score := 0.0
		if passed {
			score = 1
		}
		result.Score = &score
	}
	if details != "" {
		result.Details = &details
	}
	return result
}
