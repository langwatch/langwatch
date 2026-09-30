package services

import (
	"slices"
	"strconv"
	"strings"

	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/contract"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/rules"
)

// The default judge prompts of select_best_compare.py, one per (golden x
// input) presence combination; rules.DefaultSelectBestPrompt is the first.
const (
	selectBestPromptNoGolden = `Pick the best of N candidate replies to the task — there is no reference
answer, so compare them on their own merits.

Task:  {input}

Candidates:
{candidates}

Look across the candidates and decide which one is the best reply.
Briefly explain WHY it's better than the others, then pick the winning
slot label. Use "tie" only when no candidate is clearly better.
`
	selectBestPromptGoldenNoInput = `Pick the best of N candidate replies.

Reference:  {golden}

Candidates:
{candidates}

Compare each candidate against the reference answer and decide which one
is closest. Briefly explain WHY it's better than the others, then pick the
winning slot label. Use "tie" only when no candidate is clearly better.
`
	selectBestPromptNoGoldenNoInput = `Pick the best of N candidate replies — there is no task description or
reference answer, so compare them on their own merits.

Candidates:
{candidates}

Look across the candidates and decide which one is the best reply.
Briefly explain WHY it's better than the others, then pick the winning
slot label. Use "tie" only when no candidate is clearly better.
`
	selectBestMetricsNote = "\n\nSome candidates above are annotated with cost and/or duration. Factor these into your decision, preferring a cheaper or faster candidate only when quality is comparable."

	selectBestSystemMessage = `You are an impartial judge picking the best of several candidate outputs. Reason briefly, then pick the winning slot label using the provided function call. Judge the candidates' content only, ignore the order in which they are presented. In your reasoning write every slot as "Candidate A", "Candidate B" and so on, never as a bare letter; the winner field still takes the bare label.`
)

// selectBestDefaultFor is _pick_default_select_best_prompt.
func selectBestDefaultFor(hasGolden, hasInput bool) string {
	switch {
	case hasGolden && hasInput:
		return rules.DefaultSelectBestPrompt
	case hasGolden:
		return selectBestPromptGoldenNoInput
	case hasInput:
		return selectBestPromptNoGolden
	}
	return selectBestPromptNoGoldenNoInput
}

func isSelectBestDefaultPrompt(prompt string) bool {
	trimmed := strings.TrimSpace(prompt)
	return slices.ContainsFunc([]string{rules.DefaultSelectBestPrompt, selectBestPromptGoldenNoInput, selectBestPromptNoGolden, selectBestPromptNoGoldenNoInput}, func(candidate string) bool {
		return strings.TrimSpace(candidate) == trimmed
	})
}

// selectBestPrompt is the judge's user message: an untouched default is swapped
// for the one matching what the row carries, then the slots are filled in order.
func selectBestPrompt(settings rules.SelectBestCompareSettings, entry contract.Entry, ordered []selectBestCandidate) string {
	prompt := settings.Prompt
	if isSelectBestDefaultPrompt(prompt) {
		hasInput := strings.TrimSpace(entryText(entry.Input)) != ""
		hasGolden := settings.HasGoldenAnswer && strings.TrimSpace(entryText(entry.Golden)) != ""
		prompt = selectBestDefaultFor(hasGolden, hasInput)
		if len(settings.IncludeMetrics) > 0 {
			prompt += selectBestMetricsNote
		}
	}
	prompt = strings.ReplaceAll(prompt, "{input}", entryText(entry.Input))
	prompt = strings.ReplaceAll(prompt, "{golden}", entryText(entry.Golden))
	return strings.ReplaceAll(prompt, "{candidates}", selectBestCandidatesBlock(settings.IncludeMetrics, ordered))
}

// selectBestCandidatesBlock is the bulleted list of slots, with the metrics asked for.
func selectBestCandidatesBlock(metrics []string, ordered []selectBestCandidate) string {
	lines := make([]string, len(ordered))
	for i := range ordered {
		lines[i] = "- " + selectBestSlotLabel(i) + ": " + ordered[i].Output + selectBestMetricSuffix(metrics, &ordered[i])
	}
	return strings.Join(lines, "\n")
}

func selectBestMetricSuffix(metrics []string, candidate *selectBestCandidate) string {
	var parts []string
	if slices.Contains(metrics, "cost") && candidate.Cost != nil {
		parts = append(parts, "cost=$"+strconv.FormatFloat(*candidate.Cost, 'f', 6, 64))
	}
	if slices.Contains(metrics, "duration") && candidate.Duration != nil {
		parts = append(parts, "duration="+strconv.FormatFloat(*candidate.Duration, 'f', 3, 64)+"s")
	}
	if len(parts) == 0 {
		return ""
	}
	return "  [" + strings.Join(parts, ", ") + "]"
}

// selectBestSlotLabel is _slot_label: A..Z, then AA, AB, ...
func selectBestSlotLabel(index int) string {
	label := ""
	for n := index; n >= 0; n = n/26 - 1 {
		label = string(rune('A'+n%26)) + label
	}
	return label
}
