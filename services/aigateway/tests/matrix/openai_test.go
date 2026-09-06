//go:build live_openai

package matrix

import (
	"os"
	"testing"
)

// openaiCell builds a resolved cell for the openai provider using TEST_VK_OPENAI
// + OPENAI_MODEL (defaults to gpt-5-mini).
func openaiCell(t *testing.T, scenario string, body func(string) []byte, streaming bool) resolvedCell {
	t.Helper()
	vk := requireEnv(t, "TEST_VK_OPENAI")
	model := os.Getenv("OPENAI_MODEL")
	if model == "" {
		model = "gpt-5-mini"
	}
	return resolvedCell{
		cell:      cell{provider: "openai", scenario: scenario, body: body},
		vk:        vk,
		model:     model,
		streaming: streaming,
	}
}

func TestOpenAI_SimpleCompletion(t *testing.T) {
	runCell(t, openaiCell(t, "simple", chatBody_Simple, false))
}

func TestOpenAI_StreamedCompletion(t *testing.T) {
	runCell(t, openaiCell(t, "streamed", chatBody_Streamed, true))
}

// TestOpenAI_StreamedAutoIncludeUsage exercises the auto-injection path:
// the request body carries stream=true WITHOUT stream_options, the gateway
// must inject stream_options.include_usage=true before forwarding so the
// upstream's final SSE chunk carries real token counts. The runCell
// assertion fails unless the trace lands with total_cost > 0 AND
// prompt+completion tokens > 0 — which requires the injection to work.
func TestOpenAI_StreamedAutoIncludeUsage(t *testing.T) {
	runCell(t, openaiCell(t, "streamed_auto_include_usage", chatBody_StreamedNoUsageOption, true))
}

// The openai lane raw-forwards the body, so the cap reaches OpenAI as
// sent. These cells close the "accepted but never verified to CAP" gap:
// max_completion_tokens must verifiably bound the output. gpt-5* counts
// reasoning tokens inside completion_tokens, so the cap is set high
// enough (32) to be a meaningful bound while still forcing "length" on a
// count-to-200 prompt. No max_tokens cells here: gpt-5* rejects the
// legacy field upstream with a 400 that passes through verbatim, which is
// the documented v1 pass-through behavior covered by the scenarios above.
func TestOpenAI_MaxCompletionTokensCap(t *testing.T) {
	runCapCell(t, openaiCell(t, "cap_max_completion_tokens", nil, false), "max_completion_tokens", 32)
}

func TestOpenAI_MaxCompletionTokensCapStreamed(t *testing.T) {
	runCapCell(t, openaiCell(t, "cap_max_completion_tokens_streamed", nil, true), "max_completion_tokens", 32)
}

func TestOpenAI_ToolCalling(t *testing.T) {
	runCell(t, openaiCell(t, "tool_calling", chatBody_ToolCalling, false))
}

func TestOpenAI_StructuredOutputs(t *testing.T) {
	runCell(t, openaiCell(t, "structured_outputs", chatBody_StructuredOutputs, false))
}

func TestOpenAI_Cache(t *testing.T) {
	// gpt-5-mini (and other reasoning models) don't return
	// `prompt_tokens_details.cached_tokens` > 0 on this account — verified
	// with direct-to-api.openai.com calls. gpt-4o-mini caches reliably with
	// the same prefix. Override via OPENAI_CACHE_MODEL when testing a
	// different OpenAI model family's cache behaviour.
	cell := openaiCell(t, "cache", chatBody_Cache_Prime, false)
	if override := os.Getenv("OPENAI_CACHE_MODEL"); override != "" {
		cell.model = override
	} else {
		cell.model = "gpt-4o-mini"
	}
	runCacheCell(t, cell)
}
