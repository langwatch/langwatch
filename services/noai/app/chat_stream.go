package app

import (
	"context"
	"time"

	"github.com/langwatch/langwatch/pkg/ksuid"
)

// ChatStreamChunk is one SSE chunk in /v1/chat/completions stream mode.
// Mirrors the OpenAI shape closely enough for any client that recognises
// `chat.completion.chunk` events to parse the deltas.
type ChatStreamChunk struct {
	ID      string             `json:"id"`
	Object  string             `json:"object"`
	Created int64              `json:"created"`
	Model   string             `json:"model"`
	Choices []ChatStreamChoice `json:"choices"`
}

// ChatStreamChoice is one choice slice of an SSE chunk.
type ChatStreamChoice struct {
	Index        int             `json:"index"`
	Delta        ChatStreamDelta `json:"delta"`
	FinishReason *string         `json:"finish_reason"`
}

// ChatStreamDelta carries the incremental text (and on the first chunk,
// the assistant role). Audio is emitted as a single delta on the chunk
// just before the finish chunk.
type ChatStreamDelta struct {
	Role    string          `json:"role,omitempty"`
	Content string          `json:"content,omitempty"`
	Audio   *AssistantAudio `json:"audio,omitempty"`
}

// BuildChatStreamChunks assembles the SSE chunk sequence for a request.
// The fake server emits a tiny script: role-only, full-content delta,
// optional audio delta, then a finish-reason chunk. Real providers
// stream token-by-token; that level of detail isn't useful here and
// just inflates test fixtures.
func BuildChatStreamChunks(ctx context.Context, req ChatRequest, now time.Time) []ChatStreamChunk {
	model, _ := Normalize(req.Model)
	last := ExtractLastUserTextChat(req.Messages)
	reply := model.Reply(last)

	id := ksuid.Generate(ctx, ResourceChatCompletion).String()
	created := now.Unix()
	base := func(delta ChatStreamDelta, finish *string) ChatStreamChunk {
		return ChatStreamChunk{
			ID:      id,
			Object:  "chat.completion.chunk",
			Created: created,
			Model:   req.Model,
			Choices: []ChatStreamChoice{{Index: 0, Delta: delta, FinishReason: finish}},
		}
	}

	chunks := []ChatStreamChunk{
		base(ChatStreamDelta{Role: "assistant"}, nil),
		base(ChatStreamDelta{Content: reply}, nil),
	}
	if model.HasAudioOutput() || requestAsksForAudio(req) {
		chunks = append(chunks, base(ChatStreamDelta{Audio: &AssistantAudio{
			ID:         ksuid.Generate(ctx, ResourceAudio).String(),
			Data:       SilentWavBase64,
			Transcript: reply,
			ExpiresAt:  now.Add(1 * time.Hour).Unix(),
			Format:     AudioFormat,
		}}, nil))
	}
	stop := "stop"
	chunks = append(chunks, base(ChatStreamDelta{}, &stop))
	return chunks
}
