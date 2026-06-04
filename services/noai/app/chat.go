package app

import (
	"context"
	"encoding/json"
	"time"

	"github.com/langwatch/langwatch/pkg/ksuid"
)

// ChatRequest is the (subset of the) OpenAI /v1/chat/completions request
// body the noai service inspects. Unknown fields are ignored.
type ChatRequest struct {
	Model    string          `json:"model"`
	Messages []ChatMessage   `json:"messages"`
	Stream   bool            `json:"stream"`
	// Audio request flag — OpenAI uses `modalities: ["text","audio"]` plus
	// an `audio` object to request audio output. We don't care about the
	// voice / format choices for the fake, just whether audio is asked for.
	Modalities []string        `json:"modalities,omitempty"`
	Audio      json.RawMessage `json:"audio,omitempty"`
}

// ChatMessage is a single chat-completions message. Content can be a
// string or an array of typed parts, so we keep it as raw JSON.
type ChatMessage struct {
	Role    string          `json:"role"`
	Content json.RawMessage `json:"content"`
}

// ChatResponse is the non-streaming response shape.
type ChatResponse struct {
	ID      string       `json:"id"`
	Object  string       `json:"object"`
	Created int64        `json:"created"`
	Model   string       `json:"model"`
	Choices []ChatChoice `json:"choices"`
	Usage   Usage        `json:"usage"`
}

// ChatChoice is a single completion choice.
type ChatChoice struct {
	Index        int                  `json:"index"`
	Message      ChatAssistantMessage `json:"message"`
	FinishReason string               `json:"finish_reason"`
}

// ChatAssistantMessage carries the assistant's text and (optionally) an
// audio blob. OpenAI puts audio under the `audio` field, alongside text
// content rather than inside the content array.
type ChatAssistantMessage struct {
	Role    string         `json:"role"`
	Content string         `json:"content"`
	Audio   *AssistantAudio `json:"audio,omitempty"`
}

// AssistantAudio matches OpenAI's chat audio output shape.
type AssistantAudio struct {
	ID         string `json:"id"`
	Data       string `json:"data"`
	Transcript string `json:"transcript"`
	ExpiresAt  int64  `json:"expires_at"`
	Format     string `json:"format,omitempty"`
}

// Usage is the OpenAI usage shape, zeroed out for the fake.
type Usage struct {
	PromptTokens     int `json:"prompt_tokens"`
	CompletionTokens int `json:"completion_tokens"`
	TotalTokens      int `json:"total_tokens"`
}

// BuildChatResponse assembles a deterministic ChatResponse for the given
// request. Unknown models fall through to echo-text behavior so a typo
// produces a recognizable response rather than an opaque 4xx.
//
// Response, audio, and message ids are KSUIDs (env-prefixed via ctx), so
// concurrent requests get unique ids and the surfaces are traceable from
// logs just like every other LangWatch ID.
func BuildChatResponse(ctx context.Context, req ChatRequest, now time.Time) ChatResponse {
	model, _ := Normalize(req.Model)
	last := ExtractLastUserTextChat(req.Messages)
	reply := model.Reply(last)

	msg := ChatAssistantMessage{Role: "assistant", Content: reply}
	if model.HasAudioOutput() || requestAsksForAudio(req) {
		msg.Audio = &AssistantAudio{
			ID:         ksuid.Generate(ctx, ResourceAudio).String(),
			Data:       SilentWavBase64,
			Transcript: reply,
			ExpiresAt:  now.Add(1 * time.Hour).Unix(),
			Format:     AudioFormat,
		}
	}

	return ChatResponse{
		ID:      ksuid.Generate(ctx, ResourceChatCompletion).String(),
		Object:  "chat.completion",
		Created: now.Unix(),
		Model:   req.Model,
		Choices: []ChatChoice{{Index: 0, Message: msg, FinishReason: "stop"}},
		Usage:   Usage{},
	}
}

// requestAsksForAudio returns true when the caller set `modalities`
// including "audio". This lets text-typed models still emit an audio
// blob when the caller explicitly asks for one (mirrors real OpenAI
// behavior for gpt-4o-audio-preview).
func requestAsksForAudio(req ChatRequest) bool {
	for _, m := range req.Modalities {
		if m == "audio" {
			return true
		}
	}
	return false
}
