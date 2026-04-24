//go:build live_bedrock

package matrix

import (
	"os"
	"testing"
)

// bedrockCell builds a resolved cell for AWS Bedrock using TEST_VK_BEDROCK
// + BEDROCK_MODEL (defaults to claude-3-5-haiku-20241022).
//
// The gateway's bifrost adapter routes Bedrock requests through the AWS SDK
// using credentials bound to the VK via the ModelProvider, not env-based
// boto/SDK credentials — the TEST_VK_BEDROCK VK must have a Bedrock
// credential bound with AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY /
// AWS_DEFAULT_REGION in its encrypted customKeys blob.
func bedrockCell(t *testing.T, scenario string, body func(string) []byte, streaming bool) resolvedCell {
	t.Helper()
	vk := requireEnv(t, "TEST_VK_BEDROCK")
	model := os.Getenv("BEDROCK_MODEL")
	if model == "" {
		model = "anthropic.claude-3-5-haiku-20241022-v1:0"
	}
	return resolvedCell{
		cell:      cell{provider: "bedrock", scenario: scenario, body: body},
		vk:        vk,
		model:     model,
		streaming: streaming,
	}
}

func TestBedrock_SimpleCompletion(t *testing.T) {
	runCell(t, bedrockCell(t, "simple", chatBody_Simple, false))
}

func TestBedrock_StreamedCompletion(t *testing.T) {
	runCell(t, bedrockCell(t, "streamed", chatBody_Streamed, true))
}

func TestBedrock_ToolCalling(t *testing.T) {
	runCell(t, bedrockCell(t, "tool_calling", chatBody_ToolCalling, false))
}

func TestBedrock_StructuredOutputs(t *testing.T) {
	runCell(t, bedrockCell(t, "structured_outputs", chatBody_StructuredOutputs, false))
}
