package services

import "encoding/json"

// RagasLLMPrepares hands ragasLLMPrepares to the replay tests, which must
// not depend on BuiltinEvaluators listing them.
func RagasLLMPrepares() map[string]func(json.RawMessage) (Score, error) {
	return ragasLLMPrepares()
}
