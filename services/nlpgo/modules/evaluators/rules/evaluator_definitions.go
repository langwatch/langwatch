// Package rules holds the evaluators module's pure decisions: which
// evaluators exist and what they accept, fair share, and each rule-based
// evaluator's scoring. Nothing here performs I/O.
package rules

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

// Definition is one evaluator's metadata: the catalogue source (plan §7).
type Definition struct {
	Slug            string
	RequiredFields  []string
	DefaultSettings any
}

// Definitions returns every evaluator the runtime serves, keyed by slug.
func Definitions() map[string]Definition {
	return map[string]Definition{
		"langevals/exact_match": {
			Slug:            "langevals/exact_match",
			RequiredFields:  []string{FieldOutput, FieldExpectedOutput},
			DefaultSettings: DefaultExactMatchSettings(),
		},
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
