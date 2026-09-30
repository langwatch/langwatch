package rules

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// judgeGolden is langevals' own answer (testdata/judge_fit.json, written by
// fit_judge_content and litellm's trim_messages) for contexts and trimming,
// which no recorded judge case exercises.
type judgeGolden struct {
	Fit struct {
		Request struct {
			Model         string   `json:"model"`
			MaxTokens     int      `json:"max_tokens"`
			ReservedTexts []string `json:"reserved_texts"`
			Input         string   `json:"input"`
			Output        string   `json:"output"`
			Contexts      []string `json:"contexts"`
		} `json:"request"`
		Input         string   `json:"input"`
		Output        string   `json:"output"`
		Contexts      []string `json:"contexts"`
		OmittedTokens int      `json:"omitted_tokens"`
		Budget        int      `json:"budget"`
	} `json:"fit"`
	Trim []struct {
		Messages  []goldenMessage `json:"messages"`
		MaxTokens int             `json:"max_tokens"`
		Trimmed   []goldenMessage `json:"trimmed"`
	} `json:"trim"`
}

type goldenMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

func readJudgeGolden(t *testing.T) (judgeGolden, *TokenCounter) {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("testdata", "judge_fit.json"))
	require.NoError(t, err)
	var golden judgeGolden
	require.NoError(t, json.Unmarshal(raw, &golden))
	counter, err := NewTokenCounter()
	require.NoError(t, err)
	return golden, counter
}

func TestFitJudgeContentCutsContextsAndFieldsAsLangevals(t *testing.T) {
	golden, counter := readJudgeGolden(t)
	req := golden.Fit.Request
	fit := counter.FitJudgeContent(JudgeFitRequest{
		Model:     req.Model,
		MaxTokens: req.MaxTokens,
		Reserved:  req.ReservedTexts,
		Fields:    JudgeFields{Input: &req.Input, Output: &req.Output, Contexts: req.Contexts},
	})
	require.Empty(t, fit.Skip)
	assert.Equal(t, golden.Fit.Input, *fit.Fields.Input)
	assert.Equal(t, golden.Fit.Output, *fit.Fields.Output)
	assert.Equal(t, golden.Fit.Contexts, fit.Fields.Contexts)
	assert.Equal(t, golden.Fit.OmittedTokens, fit.OmittedTokens)
	assert.Equal(t, golden.Fit.Budget, fit.Budget)
}

func TestTrimJudgeMessagesTrimsAsLitellm(t *testing.T) {
	golden, counter := readJudgeGolden(t)
	for _, c := range golden.Trim {
		messages := make([]JudgeMessage, len(c.Messages))
		for i, message := range c.Messages {
			messages[i] = JudgeMessage(message)
		}
		trimmed := counter.TrimJudgeMessages("gpt-4o-mini", messages, c.MaxTokens)
		want := make([]JudgeMessage, len(c.Trimmed))
		for i, message := range c.Trimmed {
			want[i] = JudgeMessage(message)
		}
		assert.Equal(t, want, trimmed)
	}
}

func TestParseAnswerMatchReadsDSPyFields(t *testing.T) {
	reasoning, verdict, ok := ParseAnswerMatch("[[ ## reasoning ## ]]\nSame city.\n\n[[ ## is_correct ## ]]\nTrue\n\n[[ ## completed ## ]]")
	require.True(t, ok)
	assert.Equal(t, "Same city.", reasoning)
	assert.Equal(t, "True", verdict)
	_, _, ok = ParseAnswerMatch("[[ ## reasoning ## ]]\nno verdict")
	assert.False(t, ok)
}
