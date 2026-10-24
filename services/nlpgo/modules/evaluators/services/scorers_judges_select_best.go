package services

import (
	"context"
	"encoding/json"
	"fmt"
	"slices"
	"strings"

	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/channels"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/contract"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/rules"
)

// selectBestCandidate is one entry in the row's candidates, as TS sends it.
type selectBestCandidate struct {
	ID       string   `json:"id"`
	Output   string   `json:"output"`
	Cost     *float64 `json:"cost"`
	Duration *float64 `json:"duration"`
}

// selectBestRun is what one row's judge calls share.
type selectBestRun struct {
	settings rules.SelectBestCompareSettings
	entry    contract.Entry
	models   *Models
}

// selectBestVerdict is one judge call's answer, or the two reconciled. The
// winner is a candidate id or "tie"; decided is false when the row has none.
type selectBestVerdict struct {
	winner     string
	decided    bool
	unanswered bool
	reasoning  string
}

// selectBestCandidates are the candidates with an output, in entry order.
func selectBestCandidates(raw json.RawMessage) ([]selectBestCandidate, bool) {
	var all []selectBestCandidate
	if len(raw) > 0 && json.Unmarshal(raw, &all) != nil {
		return nil, false
	}
	return slices.DeleteFunc(all, func(candidate selectBestCandidate) bool { return candidate.Output == "" }), true
}

func scoreSelectBest(ctx context.Context, settings rules.SelectBestCompareSettings, in EntryRun) (contract.Result, error) {
	candidates, ok := selectBestCandidates(in.Entry.Candidates)
	if !ok {
		return errorResult("ValidationError", "candidates must be a list of objects with an id and an output"), nil
	}
	if len(candidates) < 2 {
		return skippedResult(fmt.Sprintf("N-way compare needs at least 2 candidates with non-empty outputs (got %d)", len(candidates))), nil
	}
	if settings.RandomizeOrder {
		seed := 0
		if in.Entry.RowIndex != nil {
			seed = *in.Entry.RowIndex
		}
		rules.PyShuffle(seed, candidates)
	}
	run := selectBestRun{settings: settings, entry: in.Entry, models: in.Models}
	verdict, err := selectBestVerdictFor(ctx, run, candidates)
	if err != nil {
		return vendorResult(err)
	}
	return selectBestResult(verdict), nil
}

func selectBestVerdictFor(ctx context.Context, run selectBestRun, ordered []selectBestCandidate) (selectBestVerdict, error) {
	if !run.settings.SwapAndReconcile {
		return judgeSelectBest(ctx, run, ordered)
	}
	first, err := judgeSelectBest(ctx, run, ordered)
	if err != nil {
		return selectBestVerdict{}, err
	}
	reversed := slices.Clone(ordered)
	slices.Reverse(reversed)
	second, err := judgeSelectBest(ctx, run, reversed)
	if err != nil {
		return selectBestVerdict{}, err
	}
	return reconcileSelectBest(run.settings, first, second), nil
}

// selectBestResult: a row with no winner is skipped, not scored, as langevals
// has it; its spent cost is added by the service.
func selectBestResult(verdict selectBestVerdict) contract.Result {
	if !verdict.decided {
		return skippedResult(verdict.reasoning)
	}
	score := 1.0
	if verdict.winner == "tie" {
		score = 0.5
	}
	return contract.Result{Status: contract.StatusProcessed, Score: &score, Label: &verdict.winner, Details: &verdict.reasoning}
}

// selectBestTemperature is _effective_temperature: gpt-5 models take only 1.
func selectBestTemperature(settings rules.SelectBestCompareSettings) float64 {
	if strings.Contains(settings.Model, "gpt-5") {
		return 1.0
	}
	return settings.Temperature
}

// reconcileSelectBest is _reconcile: the two passes must agree, and a
// disagreement leaves the row without a winner.
func reconcileSelectBest(settings rules.SelectBestCompareSettings, first, second selectBestVerdict) selectBestVerdict {
	if first.unanswered || second.unanswered {
		unusable := first
		if !first.unanswered {
			unusable = second
		}
		return selectBestVerdict{unanswered: true, reasoning: unusable.reasoning}
	}
	pinned := selectBestTemperature(settings) == 0.0
	if first.winner == second.winner {
		confirmation := "Confirmed on a second call with the candidate order reversed."
		if pinned {
			confirmation = "Confirmed under order swap."
		}
		return selectBestVerdict{winner: first.winner, decided: true, reasoning: confirmation + "\n\n" + first.reasoning}
	}
	label, cause := "Order-sensitive verdict", "The verdict changed with candidate order."
	if !pinned {
		label = "Unreproducible verdict"
		cause = "The verdict did not survive being asked again with the candidate order reversed. This judge does not run at a fixed temperature, so the disagreement is not necessarily caused by the order."
	}
	details := label + ": this row does not establish a winner.\n\n" +
		"Original order picked " + first.winner + ":\n" + first.reasoning + "\n\n" +
		"Reversed order picked " + second.winner + ":\n" + second.reasoning + "\n\n" + cause
	return selectBestVerdict{reasoning: details}
}

// judgeSelectBest is _judge: one forced call across the candidates in order.
func judgeSelectBest(ctx context.Context, run selectBestRun, ordered []selectBestCandidate) (selectBestVerdict, error) {
	temperature := selectBestTemperature(run.settings)
	resp, err := completeJudge(ctx, run.models, channels.CompletionRequest{
		Model:       run.settings.Model,
		Temperature: &temperature,
		Messages: []channels.Message{
			{Role: "system", Content: selectBestSystemMessage},
			{Role: "user", Content: selectBestPrompt(run.settings, run.entry, ordered)},
		},
		Tools:      []json.RawMessage{selectBestTool(run.settings.AllowTie, len(ordered))},
		ToolChoice: forcedJudgeToolChoice("select_best_verdict"),
	})
	if err != nil {
		return selectBestVerdict{}, err
	}
	return readSelectBestVerdict(resp, ordered)
}

func selectBestTool(allowTie bool, slots int) json.RawMessage {
	winners := make([]string, 0, slots+1)
	for i := range slots {
		winners = append(winners, selectBestSlotLabel(i))
	}
	if allowTie {
		winners = append(winners, "tie")
	}
	winner := judgeProperty("string", "The winning slot label. Use 'tie' only when no candidate clearly wins.")
	winner["enum"] = winners
	return judgeToolSpec{
		name:        "select_best_verdict",
		description: "Record the select-best verdict. Reason first, then pick the winning slot label.",
		properties: map[string]any{
			"reasoning": judgeProperty("string", "Brief explanation of why the winning candidate is the best reply — keep it brief."),
			"winner":    winner,
		},
		required: []string{"reasoning", "winner"},
	}.render()
}

// unansweredSelectBest is a call that came back without a usable verdict:
// reported as no verdict rather than raised.
func unansweredSelectBest(whatHappened string) selectBestVerdict {
	return selectBestVerdict{unanswered: true, reasoning: "The judge " + whatHappened + ", so this row has no verdict. The call was still made and billed."}
}

// readSelectBestVerdict reads the first tool call's winner and reasoning,
// translating the slot the judge picked and named back to candidate ids.
func readSelectBestVerdict(resp channels.CompletionResponse, ordered []selectBestCandidate) (selectBestVerdict, error) {
	if len(resp.Choices) == 0 {
		return selectBestVerdict{}, &vendorFailure{errorType: "IndexError", details: "list index out of range"}
	}
	calls := resp.Choices[0].ToolCalls
	if len(calls) == 0 {
		return unansweredSelectBest("returned no answer to read"), nil
	}
	var arguments any
	if json.Unmarshal([]byte(calls[0].Arguments), &arguments) != nil {
		return unansweredSelectBest("returned an answer that could not be read"), nil //nolint:nilerr // an unreadable answer is a result, as in langevals
	}
	fields, _ := arguments.(map[string]any)
	displayed, _ := fields["winner"].(string)
	if strings.TrimSpace(displayed) == "" {
		return unansweredSelectBest("answered without naming a winner"), nil
	}
	slots := make(map[string]selectBestCandidate, len(ordered))
	for i := range ordered {
		slots[selectBestSlotLabel(i)] = ordered[i]
	}
	explanation, _ := fields["reasoning"].(string)
	if strings.TrimSpace(explanation) == "" {
		explanation = "The judge gave no explanation."
	}
	return selectBestVerdict{winner: selectBestWinnerID(displayed, slots, ordered), decided: true, reasoning: translateSlotReferences(explanation, slots)}, nil
}

// selectBestWinnerID is the picked slot's candidate id; a slot never
// presented degrades to the first, as langevals does.
func selectBestWinnerID(displayed string, slots map[string]selectBestCandidate, ordered []selectBestCandidate) string {
	if displayed == "tie" {
		return "tie"
	}
	if candidate, ok := slots[displayed]; ok {
		return candidate.ID
	}
	return ordered[0].ID
}
