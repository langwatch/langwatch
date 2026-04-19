package dispatch

import (
	"testing"

	bfschemas "github.com/maximhq/bifrost/core/schemas"
)

func TestExtractUsageFromStreamChunk_NilChunk(t *testing.T) {
	if _, _, _, _, _, ok := extractUsageFromStreamChunk(nil); ok {
		t.Error("nil chunk must report ok=false")
	}
}

func TestExtractUsageFromStreamChunk_NoUsageField(t *testing.T) {
	chunk := &bfschemas.BifrostStreamChunk{
		BifrostChatResponse: &bfschemas.BifrostChatResponse{},
	}
	if _, _, _, _, _, ok := extractUsageFromStreamChunk(chunk); ok {
		t.Error("chunk without Usage must report ok=false")
	}
}

func TestExtractUsageFromStreamChunk_ReturnsTokens(t *testing.T) {
	chunk := &bfschemas.BifrostStreamChunk{
		BifrostChatResponse: &bfschemas.BifrostChatResponse{
			Usage: &bfschemas.BifrostLLMUsage{
				PromptTokens:     120,
				CompletionTokens: 45,
				TotalTokens:      165,
			},
		},
	}
	in, out, _, _, _, ok := extractUsageFromStreamChunk(chunk)
	if !ok {
		t.Fatal("expected ok=true when usage is present")
	}
	if in != 120 || out != 45 {
		t.Errorf("tokens mismatch: in=%d out=%d", in, out)
	}
}

func TestExtractUsageFromStreamChunk_AllZeroTreatedAsMissing(t *testing.T) {
	// OpenAI-style SSE often emits an empty usage struct in deltas
	// before the final chunk with the real counts. We treat all-zero
	// as "no usage yet" so the *last* real usage wins, not a later
	// zero stomp.
	chunk := &bfschemas.BifrostStreamChunk{
		BifrostChatResponse: &bfschemas.BifrostChatResponse{
			Usage: &bfschemas.BifrostLLMUsage{},
		},
	}
	if _, _, _, _, _, ok := extractUsageFromStreamChunk(chunk); ok {
		t.Error("all-zero usage should report ok=false so previous non-zero snapshot wins")
	}
}
