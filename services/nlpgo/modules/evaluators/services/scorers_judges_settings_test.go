package services_test

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/channels"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/contract"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/services"
)

// scoreAnswer is an llm_score model that calls `evaluation` with finalScore.
func scoreAnswer(finalScore float64) func(context.Context, channels.CompletionRequest) (channels.CompletionResponse, error) {
	return func(context.Context, channels.CompletionRequest) (channels.CompletionResponse, error) {
		arguments, _ := json.Marshal(map[string]any{"reasoning": "the answer is thorough", "final_score": finalScore})
		return channels.CompletionResponse{Choices: []channels.Choice{{ToolCalls: []channels.ToolCall{{Name: "evaluation", Arguments: string(arguments)}}, FinishReason: "tool_calls"}}}, nil
	}
}

func evaluateLLMScore(t *testing.T, settings string, finalScore float64) (contract.Result, []channels.CompletionRequest) {
	t.Helper()
	service, llm := catalogueService(services.BuiltinEvaluators())
	llm.ScriptComplete(scoreAnswer(finalScore))
	input, output := "How do I reset my password?", "Open settings, choose security, then reset password."

	results, err := service.Evaluate(t.Context(), contract.EvaluateRequest{
		Tenant:    tenant("acme"),
		Evaluator: "langevals/llm_score",
		Entries:   []contract.Entry{{Input: &input, Output: &output}},
		Settings:  json.RawMessage(settings),
	})

	require.NoError(t, err)
	require.Len(t, results, 1)
	return results[0], llm.Completions()
}

// @scenario "An unset max tokens budgets the judge at 128000 and sends none to the provider"
func TestJudgeWithUnsetMaxTokensJudgesAndSendsNoMaxTokens(t *testing.T) {
	for _, settings := range []string{`{}`, `{"max_tokens":null}`} {
		result, calls := evaluateLLMScore(t, settings, 0.8)

		assert.Equal(t, contract.StatusProcessed, result.Status, settings)
		require.Len(t, calls, 1, settings)
		assert.Nil(t, calls[0].MaxTokens, settings)
	}
}

// @scenario "The score judge takes a min and max and keeps the model's score as given"
func TestScoreJudgeKeepsTheModelsScoreWhateverItsRange(t *testing.T) {
	result, calls := evaluateLLMScore(t, `{"prompt":"Rate the answer from 1 to 5","min":1,"max":5}`, 7)

	assert.Equal(t, contract.StatusProcessed, result.Status)
	require.NotNil(t, result.Score)
	assert.InDelta(t, 7.0, *result.Score, 0, "langevals never clamps the score to the range")
	require.Len(t, calls, 1)
	assert.Equal(t, "Rate the answer from 1 to 5. Always output a valid json for the function call", calls[0].Messages[0].Content, "the range adds nothing to the prompt")
}
