// Package rules holds the evaluators module's pure decisions: which
// evaluators exist and what they accept, fair share, and each rule-based
// evaluator's scoring. Nothing here performs I/O.
package rules

// Settings convention (plan §7): one struct per model; `json` is the wire name
// and order, `desc` the description, `enum:"a,b"` the literal set and
// `required:"true"` a field without a default. Nested models are structs; a
// list element's own defaults come from Defaults() (Defaulter). Defaults live
// in Default<Name>Settings(); a nil pointer is an unset Optional.

import (
	"encoding/json"

	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/contract"
)

// Entry field names, as langevals' wire spells them.
const (
	FieldInput            = "input"
	FieldOutput           = "output"
	FieldExpectedOutput   = "expected_output"
	FieldContexts         = "contexts"
	FieldExpectedContexts = "expected_contexts"
	FieldConversation     = "conversation"
)

// Definition is one evaluator's catalogue entry (plan §7): what
// evaluators.generated.ts lists for it.
type Definition struct {
	Slug            string
	Name            string
	Description     string
	Category        string
	DocsURL         string
	IsGuardrail     bool
	RequiredFields  []string
	OptionalFields  []string
	EnvVars         []string
	Result          ResultDescriptions
	DefaultSettings any
}

// ResultDescriptions describe what a result's score, passed and label mean;
// empty when the evaluator keeps the base description.
type ResultDescriptions struct {
	Score  string
	Passed string
	Label  string
}

// Definitions lists every evaluator in the catalogue, in its order. Only
// those services.BuiltinEvaluators pairs with a scorer are served.
func Definitions() []Definition {
	return []Definition{
		presidioPIIDetectionDefinition(),
		azureContentSafetyDefinition(),
		azureJailbreakDefinition(),
		azurePromptInjectionDefinition(),
		basicDefinition(),
		competitorBlocklistDefinition(),
		competitorLLMDefinition(),
		competitorLLMFunctionCallDefinition(),
		exactMatchDefinition(),
		llmAnswerMatchDefinition(),
		llmBooleanDefinition(),
		llmCategoryDefinition(),
		llmScoreDefinition(),
		offTopicDefinition(),
		pairwiseCompareDefinition(),
		queryResolutionDefinition(),
		selectBestCompareDefinition(),
		sentimentDefinition(),
		similarityDefinition(),
		validFormatDefinition(),
		ragasBLEUScoreDefinition(),
		ragasContextF1Definition(),
		ragasContextPrecisionDefinition(),
		ragasContextRecallDefinition(),
		ragasFactualCorrectnessDefinition(),
		ragasFaithfulnessDefinition(),
		ragasResponseContextPrecisionDefinition(),
		ragasResponseContextRecallDefinition(),
		ragasResponseRelevancyDefinition(),
		ragasROUGEScoreDefinition(),
		ragasRubricsBasedScoringDefinition(),
		ragasSQLQueryEquivalenceDefinition(),
		ragasSummarizationScoreDefinition(),
		linguaLanguageDetectionDefinition(),
		openAIModerationDefinition(),
	}
}

// MissingFields names the required fields an entry does not carry. A present
// but empty string counts as carried, as pydantic's `str` does.
func MissingFields(entry contract.Entry, required []string) []string {
	var missing []string
	for _, field := range required {
		if !hasField(entry, field) {
			missing = append(missing, field)
		}
	}
	return missing
}

func hasField(entry contract.Entry, field string) bool {
	switch field {
	case FieldInput:
		return entry.Input != nil
	case FieldOutput:
		return entry.Output != nil
	case FieldExpectedOutput:
		return entry.ExpectedOutput != nil
	case FieldContexts:
		return isPresentJSON(entry.Contexts)
	case FieldExpectedContexts:
		return isPresentJSON(entry.ExpectedContexts)
	case FieldConversation:
		return isPresentJSON(entry.Conversation)
	default:
		return false
	}
}

func isPresentJSON(raw json.RawMessage) bool {
	return len(raw) > 0 && string(raw) != "null"
}
