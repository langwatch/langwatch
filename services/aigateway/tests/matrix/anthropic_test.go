//go:build live_anthropic

package matrix

import (
	"os"
	"testing"
)

// anthropicCell builds a resolved cell for the anthropic provider using
// TEST_VK_ANTHROPIC + ANTHROPIC_MODEL (defaults to claude-haiku-4-5-20251001).
func anthropicCell(t *testing.T, scenario string, body func(string) []byte, streaming bool) resolvedCell {
	t.Helper()
	vk := requireEnv(t, "TEST_VK_ANTHROPIC")
	model := os.Getenv("ANTHROPIC_MODEL")
	if model == "" {
		model = "claude-haiku-4-5-20251001"
	}
	return resolvedCell{
		cell:      cell{provider: "anthropic", scenario: scenario, body: body},
		vk:        vk,
		model:     model,
		streaming: streaming,
	}
}

func TestAnthropic_SimpleCompletion(t *testing.T) {
	runCell(t, anthropicCell(t, "simple", chatBody_Simple, false))
}

func TestAnthropic_StreamedCompletion(t *testing.T) {
	runCell(t, anthropicCell(t, "streamed", chatBody_Streamed, true))
}

func TestAnthropic_ToolCalling(t *testing.T) {
	runCell(t, anthropicCell(t, "tool_calling", chatBody_ToolCalling, false))
}

func TestAnthropic_StructuredOutputs(t *testing.T) {
	runCell(t, anthropicCell(t, "structured_outputs", chatBody_StructuredOutputs, false))
}

func TestAnthropic_Cache(t *testing.T) {
	// Anthropic cache cell hits /v1/messages with the native Anthropic body
	// shape so cache_control markers + cache_*_input_tokens counters
	// round-trip intact through the gateway's raw-forward. Going via
	// /v1/chat/completions translates the response to OpenAI-shape and
	// drops Anthropic's cache usage fields.
	//
	// Default model is Sonnet 4.5 (cache GA); Haiku 4.5 prompt caching is
	// still beta per Anthropic docs — direct-api returns 0/0 on Haiku.
	// Override via ANTHROPIC_CACHE_MODEL once Haiku cache opens.
	cell := anthropicCell(t, "cache", anthropicNativeCache_Prime, false)
	cell.endpoint = "/v1/messages"
	if override := os.Getenv("ANTHROPIC_CACHE_MODEL"); override != "" {
		cell.model = override
	} else {
		cell.model = "claude-sonnet-4-5-20250929"
	}
	runCacheCellWith(t, cell, anthropicNativeCache_Prime, anthropicNativeCache_Read)
}
