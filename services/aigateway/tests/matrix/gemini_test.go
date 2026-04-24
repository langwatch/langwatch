//go:build live_gemini

package matrix

import (
	"os"
	"testing"
)

// geminiCell builds a resolved cell for the gemini (Google AI Studio) provider
// using TEST_VK_GEMINI + GEMINI_MODEL (defaults to gemini-2.5-flash).
func geminiCell(t *testing.T, scenario string, body func(string) []byte, streaming bool) resolvedCell {
	t.Helper()
	vk := requireEnv(t, "TEST_VK_GEMINI")
	model := os.Getenv("GEMINI_MODEL")
	if model == "" {
		model = "gemini-2.5-flash"
	}
	return resolvedCell{
		cell:      cell{provider: "gemini", scenario: scenario, body: body},
		vk:        vk,
		model:     model,
		streaming: streaming,
	}
}

func TestGemini_SimpleCompletion(t *testing.T) {
	runCell(t, geminiCell(t, "simple", chatBody_Simple, false))
}

func TestGemini_StreamedCompletion(t *testing.T) {
	runCell(t, geminiCell(t, "streamed", chatBody_Streamed, true))
}

func TestGemini_ToolCalling(t *testing.T) {
	runCell(t, geminiCell(t, "tool_calling", chatBody_ToolCalling, false))
}

func TestGemini_StructuredOutputs(t *testing.T) {
	runCell(t, geminiCell(t, "structured_outputs", chatBody_StructuredOutputs, false))
}

func TestGemini_Cache(t *testing.T) {
	runCacheCell(t, geminiCell(t, "cache", chatBody_Cache_Prime, false))
}
