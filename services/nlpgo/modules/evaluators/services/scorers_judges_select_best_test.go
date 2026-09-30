package services

import (
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/contract"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/rules"
)

// translateReference pairs a reasoning with what langevals'
// _translate_slot_references returns for it, run under CPython.
var translateReference = []struct{ text, want string }{
	{"Candidate B is better than Candidate A.", "Candidate lyon is better than Candidate paris."},
	{"A concise answer is better; B wins.", "A concise answer is better; lyon wins."},
	{"A is better than B.", "paris is better than lyon."},
	{"candidate a reader would pick", "candidate a reader would pick"},
	{"More complete than A (one-liner).", "More complete than paris (one-liner)."},
	{"B's answer beats A's.", "lyon's answer beats paris's."},
	{"The letter \"B\" is quoted, and `C` too.", "The letter \"B\" is quoted, and `C` too."},
	{"C++ and B-side; slot c stays", "C++ and B-side; slot rome stays"},
	{"Option C covers it, A strikes the best balance.", "Option rome covers it, A strikes the best balance."},
	{"compared with A, B fails. A,B and C.", "compared with paris, lyon fails. paris,lyon and rome."},
	//nolint:dupword // repeated slot labels are the input under test
	{"Than A Concise Reply; Than A\nA\nC", "Than A Concise Reply; Than paris\nparis\nrome"},
	{"candidate is fine; Candidate D is unknown; slot AA", "candidate is fine; Candidate D is unknown; slot AA"},
	{"I think B. It's A’s fault, B’s too.", "I think lyon. It's paris’s fault, lyon’s too."},
}

func TestTranslateSlotReferencesMatchesLangevals(t *testing.T) {
	slots := map[string]selectBestCandidate{"A": {ID: "paris"}, "B": {ID: "lyon"}, "C": {ID: "rome"}}
	for _, c := range translateReference {
		assert.Equal(t, c.want, translateSlotReferences(c.text, slots), c.text)
	}
}

func TestSelectBestSlotLabelsRunPastZ(t *testing.T) {
	assert.Equal(t, []string{"A", "B", "Z", "AA", "AB", "BA"}, []string{
		selectBestSlotLabel(0), selectBestSlotLabel(1), selectBestSlotLabel(25),
		selectBestSlotLabel(26), selectBestSlotLabel(27), selectBestSlotLabel(52),
	})
}

func TestReconcileSelectBestAnUnansweredCallIsNotADisagreement(t *testing.T) {
	settings := rules.DefaultSelectBestCompareSettings()
	answered := selectBestVerdict{winner: "paris", decided: true, reasoning: "because"}
	unanswered := unansweredSelectBest("returned no answer to read")

	got := reconcileSelectBest(settings, answered, unanswered)

	assert.False(t, got.decided)
	assert.True(t, got.unanswered)
	assert.Equal(t, unanswered.reasoning, got.reasoning)
}

func TestReconcileSelectBestAgreementNamesTheTemperatureItRanAt(t *testing.T) {
	settings := rules.DefaultSelectBestCompareSettings()
	settings.Model = "openai/gpt-4o-mini"
	verdict := selectBestVerdict{winner: "tie", decided: true, reasoning: "equal"}

	pinned := reconcileSelectBest(settings, verdict, verdict)
	settings.Temperature = 0.7
	sampled := reconcileSelectBest(settings, verdict, verdict)

	assert.Equal(t, "Confirmed under order swap.\n\nequal", pinned.reasoning)
	assert.Equal(t, "Confirmed on a second call with the candidate order reversed.\n\nequal", sampled.reasoning)
}

func TestSelectBestPromptDropsTheFramingTheRowLacks(t *testing.T) {
	settings := rules.DefaultSelectBestCompareSettings()
	question, cost, duration := "q", 0.5, 1.25
	ordered := []selectBestCandidate{{ID: "x", Output: "one", Cost: &cost}, {ID: "y", Output: "two", Duration: &duration}}
	settings.IncludeMetrics = []string{"cost", "duration"}

	got := selectBestPrompt(settings, contract.Entry{Input: &question}, ordered)

	assert.Contains(t, got, "Task:  q\n")
	assert.NotContains(t, got, "Reference:")
	assert.Contains(t, got, "- A: one  [cost=$0.500000]\n- B: two  [duration=1.250s]")
	assert.Contains(t, got, "Factor these into your decision")
}
