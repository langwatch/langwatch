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
