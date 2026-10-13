package evaluators

import "strings"

// Inference mirrors the rules the LangWatch platform applies when an
// evaluator is attached to a test suite, so a scenario in code and one on
// the platform map the same inputs the same way:
//
//   - input, question, user_input read the first user message
//   - output, response, answer read the last agent message
//   - transcript, conversation, messages read the transcript
//   - contexts, retrieved_contexts read the retrieved contexts of the trace
//   - an expected-like input (expected_*, golden*, reference*,
//     ground_truth*) reads the one field whose name shares a word with it
//   - a tool call is never inferred

func conversationInput(id string) (StateMapping, bool) {
	switch id {
	case "input", "question", "user_input":
		return Conversation.FirstUserMessage, true
	case "output", "response", "answer":
		return Conversation.LastAgentMessage, true
	case "transcript", "conversation", "messages":
		return Conversation.Transcript, true
	case "contexts", "retrieved_contexts":
		return Trace.Contexts, true
	}
	return StateMapping{}, false
}

var expectedLikePrefixes = [...]string{"expected_", "golden", "reference", "ground_truth"}

// expectedInputWords are the field name words an expected-like input
// accepts; an input not listed accepts the words of its own name, minus
// "expected".
var expectedInputWords = map[string][]string{
	"expected_output":   {"expected", "golden", "reference", "answer", "sql", "query", "label", "target"},
	"expected_contexts": {"schema", "schemas", "context", "contexts", "table", "tables"},
}

// IsExpectedLikeInput reports whether an input names an expected value
// (expected_*, golden*, reference*, ground_truth*).
func IsExpectedLikeInput(inputID string) bool {
	id := strings.ToLower(inputID)
	for _, p := range expectedLikePrefixes {
		if strings.HasPrefix(id, p) {
			return true
		}
	}
	return false
}

// words splits an identifier into its lower-case alphanumeric words.
func words(identifier string) []string {
	return strings.FieldsFunc(strings.ToLower(identifier), func(r rune) bool {
		return (r < 'a' || r > 'z') && (r < '0' || r > '9')
	})
}

func inferField(inputID string, fieldNames []string) (StateMapping, bool) {
	switch len(fieldNames) {
	case 0:
		return StateMapping{}, false
	case 1:
		return Field(fieldNames[0]), true
	}
	accepted, listed := expectedInputWords[strings.ToLower(inputID)]
	if !listed {
		for _, w := range words(inputID) {
			if w != "expected" {
				accepted = append(accepted, w)
			}
		}
	}
	match, n := "", 0
	for _, name := range fieldNames {
		for _, w := range words(name) {
			if contains(accepted, w) {
				match, n = name, n+1
				break
			}
		}
	}
	if n != 1 {
		return StateMapping{}, false
	}
	return Field(match), true
}

func contains(list []string, s string) bool {
	for _, v := range list {
		if v == s {
			return true
		}
	}
	return false
}

// InferMappings completes the mappings of an evaluator: explicit mappings
// stay as they are, every other declared input is inferred from its name,
// and an input that cannot be inferred stays unmapped. fieldNames should be
// sorted for a deterministic result.
func InferMappings(inputs, fieldNames []string, explicit map[string]any) map[string]any {
	out := make(map[string]any, len(inputs)+len(explicit))
	for k, v := range explicit {
		out[k] = v
	}
	for _, id := range inputs {
		if _, ok := out[id]; ok {
			continue
		}
		var m StateMapping
		var ok bool
		if IsExpectedLikeInput(id) {
			m, ok = inferField(id, fieldNames)
		} else {
			m, ok = conversationInput(strings.ToLower(id))
		}
		if ok {
			out[id] = m
		}
	}
	return out
}
