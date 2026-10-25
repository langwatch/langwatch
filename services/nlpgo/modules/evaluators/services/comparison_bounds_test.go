package services_test

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/contract"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/services"
)

// @scenario "A context or ROUGE comparison too large to finish is refused as an entry error"
func TestAnOversizedComparisonIsAValidationErrorEntry(t *testing.T) {
	h := newHarness(t, contract.DefaultConfig(), 0)
	long := strings.Repeat("a", 20_000)
	contexts, err := json.Marshal([]string{long})
	require.NoError(t, err)
	words := strings.Repeat("word ", 20_000)
	cases := map[string]contract.Entry{
		"ragas/context_recall": {Contexts: contexts, ExpectedContexts: contexts},
		"ragas/rouge_score":    {Output: &words, ExpectedOutput: &words},
	}
	settings := map[string]string{"ragas/context_recall": `{}`, "ragas/rouge_score": `{"rouge_type":"rougeL"}`}
	for slug, entry := range cases {
		results, err := h.service.Evaluate(context.Background(), contract.EvaluateRequest{
			Tenant:    contract.Tenant{ProjectID: "project_bounds"},
			Evaluator: slug,
			Entries:   []contract.Entry{entry},
			Settings:  json.RawMessage(settings[slug]),
		})
		require.NoError(t, err, slug)
		require.Len(t, results, 1)
		assert.Equal(t, contract.StatusError, results[0].Status, slug)
		assert.Equal(t, "ValidationError", results[0].ErrorType, slug)
	}
}

// @scenario "A context or ROUGE comparison stops at the evaluation deadline"
func TestAComparisonPastTheDeadlineAnswersTheDeadlineError(t *testing.T) {
	ctx, cancel := context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
	defer cancel()
	side := strings.Repeat("ab", 2_500)
	contexts, err := json.Marshal([]string{side})
	require.NoError(t, err)
	expected, err := json.Marshal([]string{side + "c"})
	require.NoError(t, err)
	score, err := services.BuiltinEvaluators()["ragas/context_f1"].Prepare(json.RawMessage(`{}`))
	require.NoError(t, err)

	_, err = score(ctx, services.EntryRun{Entry: contract.Entry{Contexts: contexts, ExpectedContexts: expected}})

	require.ErrorIs(t, err, context.DeadlineExceeded)
}
