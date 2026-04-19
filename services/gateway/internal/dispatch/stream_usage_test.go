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

// TestExtractUsage_CacheTokens_NilSafe guards against the common nil-deref
// path — responses with no PromptTokensDetails (many minor providers) must
// still return in/out cleanly and zero cache counters.
func TestExtractUsage_CacheTokens_NilSafe(t *testing.T) {
	resp := &bfschemas.BifrostChatResponse{
		Usage: &bfschemas.BifrostLLMUsage{PromptTokens: 100, CompletionTokens: 50},
	}
	in, out, cr, cw, _ := extractUsage(resp)
	if in != 100 || out != 50 {
		t.Errorf("in/out mismatch: in=%d out=%d", in, out)
	}
	if cr != 0 || cw != 0 {
		t.Errorf("cache counters must be 0 when PromptTokensDetails is nil; got cr=%d cw=%d", cr, cw)
	}
}

// TestExtractUsage_CacheTokens_AnthropicShape pins the Anthropic mapping:
// cache_creation_input_tokens → CachedWriteTokens, cache_read_input_tokens
// → CachedReadTokens. Bifrost's anthropic provider already does this
// translation; this test pins the contract so a bifrost version bump that
// changes the shape surfaces in gateway-ci before it hits prod.
func TestExtractUsage_CacheTokens_AnthropicShape(t *testing.T) {
	resp := &bfschemas.BifrostChatResponse{
		Usage: &bfschemas.BifrostLLMUsage{
			PromptTokens:     1200, // includes cached (per Bifrost convention)
			CompletionTokens: 40,
			PromptTokensDetails: &bfschemas.ChatPromptTokensDetails{
				CachedReadTokens:  1100, // what Anthropic calls cache_read_input_tokens
				CachedWriteTokens: 0,
			},
		},
	}
	_, _, cr, cw, _ := extractUsage(resp)
	if cr != 1100 {
		t.Errorf("cache_read mapping broken: cr=%d want 1100", cr)
	}
	if cw != 0 {
		t.Errorf("cache_write should be 0 on second-call (read) shape; got cw=%d", cw)
	}
}

// TestExtractUsage_CacheTokens_AnthropicCreationShape covers the first-call
// side (cache_creation_input_tokens > 0, cache_read_input_tokens == 0).
func TestExtractUsage_CacheTokens_AnthropicCreationShape(t *testing.T) {
	resp := &bfschemas.BifrostChatResponse{
		Usage: &bfschemas.BifrostLLMUsage{
			PromptTokens:     1200,
			CompletionTokens: 40,
			PromptTokensDetails: &bfschemas.ChatPromptTokensDetails{
				CachedReadTokens:  0,
				CachedWriteTokens: 1100,
			},
		},
	}
	_, _, cr, cw, _ := extractUsage(resp)
	if cr != 0 || cw != 1100 {
		t.Errorf("cache_creation mapping broken: cr=%d cw=%d want 0/1100", cr, cw)
	}
}

// TestExtractUsage_CacheTokens_OpenAIShape covers the OpenAI convention —
// a single cached_tokens number maps to CachedReadTokens (OpenAI has no
// create-vs-read distinction; the 50% discount applies to reads only).
// Azure OpenAI inherits this shape.
func TestExtractUsage_CacheTokens_OpenAIShape(t *testing.T) {
	resp := &bfschemas.BifrostChatResponse{
		Usage: &bfschemas.BifrostLLMUsage{
			PromptTokens:     2048,
			CompletionTokens: 128,
			PromptTokensDetails: &bfschemas.ChatPromptTokensDetails{
				CachedReadTokens:  1024, // what OpenAI calls cached_tokens
				CachedWriteTokens: 0,
			},
		},
	}
	_, _, cr, cw, _ := extractUsage(resp)
	if cr != 1024 || cw != 0 {
		t.Errorf("OpenAI cached_tokens mapping broken: cr=%d cw=%d want 1024/0", cr, cw)
	}
}

// TestExtractUsage_CacheTokens_NilResponseSafe pins the defensive guard —
// a nil response (provider_error path before any upstream call) must not
// panic. The debit path calls extractUsage even on failure paths.
func TestExtractUsage_CacheTokens_NilResponseSafe(t *testing.T) {
	in, out, cr, cw, cost := extractUsage(nil)
	if in != 0 || out != 0 || cr != 0 || cw != 0 || cost != 0 {
		t.Errorf("nil response must return all zeros; got in=%d out=%d cr=%d cw=%d cost=%f",
			in, out, cr, cw, cost)
	}
}
