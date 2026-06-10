package app_test

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/noai/app"
)

func TestNormalize_Table(t *testing.T) {
	cases := []struct {
		name string
		id   string
		want app.ModelID
		ok   bool
	}{
		{"known with prefix", "langwatch_noai/echo-text", app.ModelEchoText, true},
		{"known bare", "echo-text", app.ModelEchoText, true},
		{"foreign prefix rejected", "openai/echo-text", "", false},
		{"unknown bare", "does-not-exist", "", false},
		{"unknown with prefix", "langwatch_noai/does-not-exist", "", false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, ok := app.Normalize(c.id)
			assert.Equal(t, c.ok, ok)
			assert.Equal(t, c.want, got)
		})
	}
}

func TestExtractLastUserTextResponses_Table(t *testing.T) {
	cases := []struct {
		name  string
		input string
		want  string
	}{
		{
			name:  "input_text part",
			input: `[{"role":"user","content":[{"type":"input_text","text":"hi there"}]}]`,
			want:  "hi there",
		},
		{
			name:  "plain text field",
			input: `[{"role":"user","text":"plain field"}]`,
			want:  "plain field",
		},
		{
			name:  "assistant role skipped",
			input: `[{"role":"assistant","text":"ignored"},{"role":"user","text":"kept"}]`,
			want:  "kept",
		},
		{
			name:  "malformed array yields empty",
			input: `[1,2,3]`,
			want:  "",
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := app.ExtractLastUserTextResponses(json.RawMessage(c.input))
			assert.Equal(t, c.want, got)
		})
	}
}

func TestExtractLastUserTextChat_BackwardsWalk(t *testing.T) {
	msgs := []app.ChatMessage{
		{Role: "user", Content: json.RawMessage(`"first user turn"`)},
		{Role: "assistant", Content: json.RawMessage(`"assistant reply"`)},
		{Role: "user", Content: json.RawMessage(`"last user turn"`)},
	}
	assert.Equal(t, "last user turn", app.ExtractLastUserTextChat(msgs))
}

func TestUserSimulation_EmptyMessages(t *testing.T) {
	req := app.ChatRequest{Model: "langwatch_noai/user-simulation-text"}
	resp := app.BuildChatResponse(context.Background(), req, time.Unix(1700000000, 0))
	assert.Equal(t, "Fake user turn (no prior context).", resp.Choices[0].Message.Content)
}

func TestChatStreamPenultimateChunkCarriesAudio(t *testing.T) {
	req := app.ChatRequest{
		Model:    "langwatch_noai/echo-audio",
		Messages: []app.ChatMessage{{Role: "user", Content: json.RawMessage(`"hi"`)}},
		Stream:   true,
	}
	chunks := app.BuildChatStreamChunks(context.Background(), req, time.Unix(1700000000, 0))
	require.GreaterOrEqual(t, len(chunks), 2)
	penultimate := chunks[len(chunks)-2]
	require.NotNil(t, penultimate.Choices[0].Delta.Audio)
	assert.Equal(t, app.SilentWavBase64, penultimate.Choices[0].Delta.Audio.Data)
}

func TestBuildResponsesResult_AudioViaModality(t *testing.T) {
	req := app.ResponsesRequest{
		Model:      "langwatch_noai/echo-text",
		Input:      json.RawMessage(`"hi"`),
		Modalities: []string{"audio"},
	}
	res := app.BuildResponsesResult(context.Background(), req, time.Unix(1700000000, 0))
	require.Len(t, res.Output[0].Content, 2)
	assert.Equal(t, "output_audio", res.Output[0].Content[1].Type)
}

func TestUsageTokenCounts(t *testing.T) {
	req := app.ChatRequest{
		Model:    "langwatch_noai/echo-text",
		Messages: []app.ChatMessage{{Role: "user", Content: json.RawMessage(`"one two three"`)}},
	}
	resp := app.BuildChatResponse(context.Background(), req, time.Unix(1700000000, 0))
	// prompt = 3 words ("one two three"); reply is the echo string.
	assert.Equal(t, 3, resp.Usage.PromptTokens)
	assert.Greater(t, resp.Usage.CompletionTokens, 0)
	assert.Equal(t, resp.Usage.PromptTokens+resp.Usage.CompletionTokens, resp.Usage.TotalTokens)

	res := app.BuildResponsesResult(context.Background(),
		app.ResponsesRequest{Model: "langwatch_noai/echo-text", Input: json.RawMessage(`"one two three"`)},
		time.Unix(1700000000, 0))
	assert.Equal(t, 3, res.Usage.InputTokens)
	assert.Equal(t, res.Usage.InputTokens+res.Usage.OutputTokens, res.Usage.TotalTokens)
}

func TestChatStreamFinalChunkCarriesUsage(t *testing.T) {
	req := app.ChatRequest{
		Model:    "langwatch_noai/echo-text",
		Messages: []app.ChatMessage{{Role: "user", Content: json.RawMessage(`"one two"`)}},
		Stream:   true,
	}
	chunks := app.BuildChatStreamChunks(context.Background(), req, time.Unix(1700000000, 0))
	final := chunks[len(chunks)-1]
	require.NotNil(t, final.Usage)
	assert.Equal(t, 2, final.Usage.PromptTokens)
}
