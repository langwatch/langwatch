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
	runCacheCell(t, openaiCell(t, "cache", chatBody_Cache_Prime, false))
}
