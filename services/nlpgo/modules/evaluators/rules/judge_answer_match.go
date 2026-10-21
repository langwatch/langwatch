package rules

import (
	"regexp"
	"strings"
)

// AnswerMatchSignatureText is ANSWER_MATCH_SIGNATURE_TEXT: DSPy's framing,
// counted against the token budget with the prompt.
const AnswerMatchSignatureText = "Your input fields are: question, gold_answer (correct answer for question), predicted_answer. Your output fields are: reasoning, is_correct (True or False). All interactions will be structured with each field in its own section."

// answerMatchSystemHead is DSPy's ChatAdapter system message for
// LLMAnswerMatchSignature, copied from the recording, up to the instructions.
const answerMatchSystemHead = "Your input fields are:\n1. `question` (str): \n2. `gold_answer` (str): correct answer for question\n3. `predicted_answer` (str): predicted answer for question\nYour output fields are:\n1. `reasoning` (str): reasoning for the answer\n2. `is_correct` (str): True or False\nAll interactions will be structured in the following way, with the appropriate values filled in.\n\n[[ ## question ## ]]\n{question}\n\n[[ ## gold_answer ## ]]\n{gold_answer}\n\n[[ ## predicted_answer ## ]]\n{predicted_answer}\n\n[[ ## reasoning ## ]]\n{reasoning}\n\n[[ ## is_correct ## ]]\n{is_correct}\n\n[[ ## completed ## ]]\nIn adhering to this structure, your objective is: "

const answerMatchOutputRequirements = "Respond with the corresponding output fields, starting with the field `[[ ## reasoning ## ]]`, then `[[ ## is_correct ## ]]`, and then ending with the marker for `[[ ## completed ## ]]`."

// AnswerMatchInputs are llm_answer_match's instructions and three fields.
type AnswerMatchInputs struct {
	Instructions string
	Question     string
	Gold         string
	Predicted    string
}

// AnswerMatchMessages are the system and user messages DSPy's ChatAdapter
// sends for llm_answer_match.
func AnswerMatchMessages(in AnswerMatchInputs) (system, user string) {
	objective := strings.Join(append([]string{""}, pySplitLines(in.Instructions)...), "\n"+strings.Repeat(" ", 8))
	user = strings.Join([]string{
		"[[ ## question ## ]]\n" + in.Question,
		"[[ ## gold_answer ## ]]\n" + in.Gold,
		"[[ ## predicted_answer ## ]]\n" + in.Predicted,
		answerMatchOutputRequirements,
	}, "\n\n")
	return answerMatchSystemHead + objective, strings.TrimSpace(user)
}

var answerMatchFieldHeader = regexp.MustCompile(`^\[\[ ## (\w+) ## \]\]`)

type answerMatchSection struct {
	header string
	lines  []string
}

// ParseAnswerMatch is ChatAdapter.parse for the two output fields; ok is
// false when either is missing (DSPy then retries with its JSON adapter).
func ParseAnswerMatch(completion string) (reasoning, isCorrect string, ok bool) {
	fields := map[string]string{}
	for _, s := range answerMatchSections(completion) {
		if _, seen := fields[s.header]; !seen && (s.header == "reasoning" || s.header == "is_correct") {
			fields[s.header] = strings.TrimSpace(strings.Join(s.lines, "\n"))
		}
	}
	reasoning, hasReasoning := fields["reasoning"]
	isCorrect, hasVerdict := fields["is_correct"]
	return reasoning, isCorrect, hasReasoning && hasVerdict
}

// answerMatchSections splits the completion at each `[[ ## field ## ]]` line.
func answerMatchSections(completion string) []answerMatchSection {
	sections := []answerMatchSection{{}}
	for _, line := range pySplitLines(completion) {
		stripped := strings.TrimSpace(line)
		match := answerMatchFieldHeader.FindStringSubmatchIndex(stripped)
		if match == nil {
			sections[len(sections)-1].lines = append(sections[len(sections)-1].lines, line)
			continue
		}
		var lines []string
		if remaining := strings.TrimSpace(line[min(match[1], len(line)):]); remaining != "" {
			lines = []string{remaining}
		}
		sections = append(sections, answerMatchSection{stripped[match[2]:match[3]], lines})
	}
	return sections
}

// pySplitLines is str.splitlines: every line boundary, no trailing empty line.
func pySplitLines(text string) []string {
	var lines []string
	runes := []rune(text)
	start := 0
	for i := 0; i < len(runes); i++ {
		switch runes[i] {
		case '\n', '\v', '\f', '\x1c', '\x1d', '\x1e', '\u0085', '\u2028', '\u2029':
		case '\r':
			lines = append(lines, string(runes[start:i]))
			if i+1 < len(runes) && runes[i+1] == '\n' {
				i++
			}
			start = i + 1
			continue
		default:
			continue
		}
		lines = append(lines, string(runes[start:i]))
		start = i + 1
	}
	if start < len(runes) {
		lines = append(lines, string(runes[start:]))
	}
	return lines
}
