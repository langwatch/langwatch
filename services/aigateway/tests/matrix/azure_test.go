//go:build live_azure

package matrix

import (
	"os"
	"testing"
)

// azureCell builds a resolved cell for Azure OpenAI using TEST_VK_AZURE +
// AZURE_MODEL (defaults to gpt-5-mini).
//
// TEST_VK_AZURE's bound ModelProvider must carry:
//   - azure_openai credential with api_key + endpoint (e.g.
//     https://langwatchopenaisweden.openai.azure.com/)
//   - a deployment_map entry mapping "gpt-5-mini" → the Azure deployment name
//     (Azure routes on deployment, not on the bare model id; the gateway's
//     bifrost adapter substitutes via pc.DeploymentMap).
func azureCell(t *testing.T, scenario string, body func(string) []byte, streaming bool) resolvedCell {
	t.Helper()
	vk := requireEnv(t, "TEST_VK_AZURE")
	model := os.Getenv("AZURE_MODEL")
	if model == "" {
		model = "gpt-5-mini"
	}
	return resolvedCell{
		cell:      cell{provider: "azure", scenario: scenario, body: body},
		vk:        vk,
		model:     model,
		streaming: streaming,
	}
}

func TestAzure_SimpleCompletion(t *testing.T) {
	runCell(t, azureCell(t, "simple", chatBody_Simple, false))
}

func TestAzure_StreamedCompletion(t *testing.T) {
	runCell(t, azureCell(t, "streamed", chatBody_Streamed, true))
}

func TestAzure_ToolCalling(t *testing.T) {
	runCell(t, azureCell(t, "tool_calling", chatBody_ToolCalling, false))
}

func TestAzure_StructuredOutputs(t *testing.T) {
	runCell(t, azureCell(t, "structured_outputs", chatBody_StructuredOutputs, false))
}

func TestAzure_Cache(t *testing.T) {
	runCacheCell(t, azureCell(t, "cache", chatBody_Cache_Prime, false))
}
