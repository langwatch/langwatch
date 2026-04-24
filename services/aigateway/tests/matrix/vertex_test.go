//go:build live_vertex

package matrix

import (
	"os"
	"testing"
)

// vertexCell builds a resolved cell for Google Vertex using TEST_VK_VERTEX +
// VERTEX_MODEL (defaults to gemini-2.5-flash, region us-central1).
//
// TEST_VK_VERTEX's bound ModelProvider must carry a vertex_ai credential
// with project_id + location + service-account JSON in customKeys.
// Bifrost handles the GCP auth exchange.
func vertexCell(t *testing.T, scenario string, body func(string) []byte, streaming bool) resolvedCell {
	t.Helper()
	vk := requireEnv(t, "TEST_VK_VERTEX")
	model := os.Getenv("VERTEX_MODEL")
	if model == "" {
		model = "gemini-2.5-flash"
	}
	return resolvedCell{
		cell:      cell{provider: "vertex", scenario: scenario, body: body},
		vk:        vk,
		model:     model,
		streaming: streaming,
	}
}

func TestVertex_SimpleCompletion(t *testing.T) {
	runCell(t, vertexCell(t, "simple", chatBody_Simple, false))
}

func TestVertex_StreamedCompletion(t *testing.T) {
	runCell(t, vertexCell(t, "streamed", chatBody_Streamed, true))
}

func TestVertex_ToolCalling(t *testing.T) {
	runCell(t, vertexCell(t, "tool_calling", chatBody_ToolCalling, false))
}

func TestVertex_StructuredOutputs(t *testing.T) {
	runCell(t, vertexCell(t, "structured_outputs", chatBody_StructuredOutputs, false))
}
