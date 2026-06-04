package app

import (
	"context"
	"encoding/json"
	"time"

	"github.com/langwatch/langwatch/pkg/ksuid"
)

// ResponsesRequest is the (subset of the) OpenAI /v1/responses request
// body the noai service inspects. The `input` field is polymorphic — a
// bare string or an array of items — so we keep it raw.
type ResponsesRequest struct {
	Model      string          `json:"model"`
	Input      json.RawMessage `json:"input"`
	Stream     bool            `json:"stream"`
	Modalities []string        `json:"modalities,omitempty"`
}

// ResponsesResult is the non-streaming /v1/responses response shape.
type ResponsesResult struct {
	ID        string           `json:"id"`
	Object    string           `json:"object"`
	CreatedAt int64            `json:"created_at"`
	Status    string           `json:"status"`
	Model     string           `json:"model"`
	Output    []ResponsesMsg   `json:"output"`
	Usage     ResponsesUsage   `json:"usage"`
	// OpenAI's library reads `output_text` as a derived convenience field.
	// Including it directly is harmless and saves callers a fold.
	OutputText string `json:"output_text,omitempty"`
}

// ResponsesMsg is one message item in the `output` array.
type ResponsesMsg struct {
	ID      string             `json:"id"`
	Type    string             `json:"type"`
	Role    string             `json:"role"`
	Content []ResponsesContent `json:"content"`
}

// ResponsesContent is a single content part inside a message. We emit
// either an `output_text` part or an `output_audio` part; that pair
// covers the modalities exposed by noai models.
type ResponsesContent struct {
	Type       string `json:"type"`
	Text       string `json:"text,omitempty"`
	Audio      string `json:"audio,omitempty"`
	Transcript string `json:"transcript,omitempty"`
	Format     string `json:"format,omitempty"`
}

// ResponsesUsage mirrors the Responses-API usage shape.
type ResponsesUsage struct {
	InputTokens  int `json:"input_tokens"`
	OutputTokens int `json:"output_tokens"`
	TotalTokens  int `json:"total_tokens"`
}

// BuildResponsesResult assembles a deterministic ResponsesResult for the
// given request. Response + message item ids are KSUIDs (env-prefixed
// via ctx).
func BuildResponsesResult(ctx context.Context, req ResponsesRequest, now time.Time) ResponsesResult {
	model, _ := Normalize(req.Model)
	last := ExtractLastUserTextResponses(req.Input)
	reply := model.Reply(last)

	parts := []ResponsesContent{{Type: "output_text", Text: reply}}
	if model.HasAudioOutput() || responsesAsksForAudio(req) {
		parts = append(parts, ResponsesContent{
			Type:       "output_audio",
			Audio:      SilentWavBase64,
			Transcript: reply,
			Format:     AudioFormat,
		})
	}

	return ResponsesResult{
		ID:        ksuid.Generate(ctx, ResourceResponses).String(),
		Object:    "response",
		CreatedAt: now.Unix(),
		Status:    "completed",
		Model:     req.Model,
		Output: []ResponsesMsg{{
			ID:      ksuid.Generate(ctx, ResourceMessageItem).String(),
			Type:    "message",
			Role:    "assistant",
			Content: parts,
		}},
		Usage:      ResponsesUsage{},
		OutputText: reply,
	}
}

func responsesAsksForAudio(req ResponsesRequest) bool {
	for _, m := range req.Modalities {
		if m == "audio" {
			return true
		}
	}
	return false
}
