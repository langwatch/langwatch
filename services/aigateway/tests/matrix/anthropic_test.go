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
	runCacheCell(t, anthropicCell(t, "cache", chatBody_Cache_Prime, false))
}
