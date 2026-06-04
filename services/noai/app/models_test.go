package app_test

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/noai/app"
)

func TestNormalize_StripsPrefix(t *testing.T) {
	got, ok := app.Normalize("langwatch_noai/echo-text")
	require.True(t, ok)
	assert.Equal(t, app.ModelEchoText, got)

	got, ok = app.Normalize("echo-text")
	require.True(t, ok)
	assert.Equal(t, app.ModelEchoText, got)
}

func TestNormalize_UnknownModel(t *testing.T) {
	_, ok := app.Normalize("langwatch_noai/does-not-exist")
	assert.False(t, ok)
}

func TestEchoTextReturnsCannedFormat(t *testing.T) {
	req := app.ChatRequest{
		Model:    "langwatch_noai/echo-text",
		Messages: userMsgs("hello world"),
	}
	resp := app.BuildChatResponse(req, time.Unix(1700000000, 0))

	assert.Equal(t, `Fake LLM Response to: "hello world"`, resp.Choices[0].Message.Content)
	assert.Nil(t, resp.Choices[0].Message.Audio, "echo-text must not include audio")
}

func TestEchoAudioIncludesWavStub(t *testing.T) {
	req := app.ChatRequest{
		Model:    "langwatch_noai/echo-audio",
		Messages: userMsgs("hi"),
	}
	resp := app.BuildChatResponse(req, time.Unix(1700000000, 0))

	require.NotNil(t, resp.Choices[0].Message.Audio)
	assert.Equal(t, app.SilentWavBase64, resp.Choices[0].Message.Audio.Data)
	assert.Equal(t, app.AudioFormat, resp.Choices[0].Message.Audio.Format)
	assert.Equal(t, `Fake LLM Response to: "hi"`, resp.Choices[0].Message.Content)
}

func TestJudgeModelsReturnDeterministicVerdict(t *testing.T) {
	cases := []struct {
		model  string
		passed bool
		score  float64
	}{
		{"langwatch_noai/judge-text-pass", true, 1},
		{"langwatch_noai/judge-text-fail", false, 0},
		{"langwatch_noai/judge-audio-pass", true, 1},
		{"langwatch_noai/judge-audio-fail", false, 0},
	}
	for _, c := range cases {
		t.Run(c.model, func(t *testing.T) {
			req := app.ChatRequest{Model: c.model, Messages: userMsgs("anything")}
			resp := app.BuildChatResponse(req, time.Unix(1700000000, 0))

			var verdict struct {
				Passed bool    `json:"passed"`
				Score  float64 `json:"score"`
			}
			require.NoError(t, json.Unmarshal([]byte(resp.Choices[0].Message.Content), &verdict))
			assert.Equal(t, c.passed, verdict.Passed)
			assert.Equal(t, c.score, verdict.Score)
		})
	}
}

func TestUserSimulationProducesFollowUp(t *testing.T) {
	req := app.ChatRequest{
		Model:    "langwatch_noai/user-simulation-text",
		Messages: userMsgs("what's your name?"),
	}
	resp := app.BuildChatResponse(req, time.Unix(1700000000, 0))
	assert.Contains(t, resp.Choices[0].Message.Content, `Fake user follow-up to: "what's your name?"`)
}

func TestUserSimulationAudioIncludesWavStub(t *testing.T) {
	req := app.ChatRequest{
		Model:    "langwatch_noai/user-simulation-audio",
		Messages: userMsgs("ping"),
	}
	resp := app.BuildChatResponse(req, time.Unix(1700000000, 0))
	require.NotNil(t, resp.Choices[0].Message.Audio)
	assert.Equal(t, app.SilentWavBase64, resp.Choices[0].Message.Audio.Data)
}

func TestRequestAsksForAudioOverridesTextOnlyModel(t *testing.T) {
	req := app.ChatRequest{
		Model:      "langwatch_noai/echo-text",
		Messages:   userMsgs("hi"),
		Modalities: []string{"text", "audio"},
	}
	resp := app.BuildChatResponse(req, time.Unix(1700000000, 0))
	require.NotNil(t, resp.Choices[0].Message.Audio,
		"caller asked for audio modality — fake should oblige even on a text-only model")
}

func TestArrayFormContentIsParsed(t *testing.T) {
	msg := app.ChatMessage{
		Role:    "user",
		Content: json.RawMessage(`[{"type":"text","text":"part one"},{"type":"text","text":"part two"}]`),
	}
	req := app.ChatRequest{Model: "langwatch_noai/echo-text", Messages: []app.ChatMessage{msg}}
	resp := app.BuildChatResponse(req, time.Unix(1700000000, 0))
	assert.Contains(t, resp.Choices[0].Message.Content, "part one")
	assert.Contains(t, resp.Choices[0].Message.Content, "part two")
}

func TestResponsesBareStringInput(t *testing.T) {
	req := app.ResponsesRequest{
		Model: "langwatch_noai/echo-text",
		Input: json.RawMessage(`"howdy"`),
	}
	res := app.BuildResponsesResult(req, time.Unix(1700000000, 0))
	assert.Equal(t, `Fake LLM Response to: "howdy"`, res.OutputText)
	require.Len(t, res.Output[0].Content, 1)
	assert.Equal(t, "output_text", res.Output[0].Content[0].Type)
}

func TestResponsesAudioOutputForAudioModel(t *testing.T) {
	req := app.ResponsesRequest{
		Model: "langwatch_noai/echo-audio",
		Input: json.RawMessage(`"hi"`),
	}
	res := app.BuildResponsesResult(req, time.Unix(1700000000, 0))
	require.Len(t, res.Output[0].Content, 2)
	assert.Equal(t, "output_audio", res.Output[0].Content[1].Type)
	assert.Equal(t, app.SilentWavBase64, res.Output[0].Content[1].Audio)
}

func TestChatStreamChunksMatchNonStreamReply(t *testing.T) {
	req := app.ChatRequest{
		Model:    "langwatch_noai/echo-text",
		Messages: userMsgs("hi"),
		Stream:   true,
	}
	chunks := app.BuildChatStreamChunks(req, time.Unix(1700000000, 0))
	// First chunk announces role, second carries content, last sets finish_reason.
	require.GreaterOrEqual(t, len(chunks), 3)
	assert.Equal(t, "assistant", chunks[0].Choices[0].Delta.Role)

	var joined strings.Builder
	for _, c := range chunks {
		joined.WriteString(c.Choices[0].Delta.Content)
	}
	assert.Equal(t, `Fake LLM Response to: "hi"`, joined.String())

	final := chunks[len(chunks)-1]
	require.NotNil(t, final.Choices[0].FinishReason)
	assert.Equal(t, "stop", *final.Choices[0].FinishReason)
}

func TestResponsesStreamEmitsCreatedAndCompleted(t *testing.T) {
	req := app.ResponsesRequest{
		Model:  "langwatch_noai/echo-text",
		Input:  json.RawMessage(`"hi"`),
		Stream: true,
	}
	events := app.BuildResponsesStreamEvents(req, time.Unix(1700000000, 0))
	require.NotEmpty(t, events)
	assert.Equal(t, "response.created", events[0].Event)
	assert.Equal(t, "response.completed", events[len(events)-1].Event)
}

func userMsgs(text string) []app.ChatMessage {
	return []app.ChatMessage{{Role: "user", Content: json.RawMessage(`"` + text + `"`)}}
}
