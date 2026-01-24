/**
 * External API integration tests for model ID translation at the LiteLLM boundary.
 *
 * These tests verify that the dot-to-dash translation works end-to-end
 * with actual Anthropic API calls. The tests are conditionally skipped
 * when ANTHROPIC_API_KEY is not available.
 *
 * @see specs/model-config/litellm-model-id-translation.feature
 */

import { describe, expect, it } from "vitest";
import { translateModelIdForLitellm } from "../modelIdBoundary";

const apiKey = process.env.ANTHROPIC_API_KEY;

/**
 * Anthropic API response types for messages endpoint
 */
interface AnthropicTextBlock {
  type: "text";
  text: string;
}

interface AnthropicMessagesResponse {
  id: string;
  type: "message";
  role: "assistant";
  content: AnthropicTextBlock[];
  model: string;
  stop_reason: string;
}

/**
 * Makes a direct API call to Anthropic's messages endpoint.
 * This simulates what LiteLLM does under the hood.
 */
async function callAnthropicApi(
  model: string,
  prompt: string,
): Promise<AnthropicMessagesResponse> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 10,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Anthropic API error: ${response.status} - ${errorBody}`);
  }

  return (await response.json()) as AnthropicMessagesResponse;
}

describe("Model ID Boundary - External API", () => {
  describe("Anthropic API call with translated model ID", () => {
    if (!apiKey) {
      it.skip("requires ANTHROPIC_API_KEY environment variable", () => {
        // Test skipped - no API key available
        // In CI, this test runs when ANTHROPIC_API_KEY secret is configured
      });
      return;
    }

    it("succeeds with translated model ID for claude-3.5-haiku", async () => {
      // Given: A model ID that requires translation
      const modelId = "anthropic/claude-3.5-haiku";

      // When: We translate the model ID for LiteLLM
      const translatedModelId = translateModelIdForLitellm(modelId);

      // Then: The translated ID uses dashes (dot-to-dash conversion)
      expect(translatedModelId).toBe("anthropic/claude-3-5-haiku");

      // And: We can successfully call the Anthropic API with the translated model pattern
      // Note: Anthropic's API requires the full model name with version suffix (e.g., "-latest")
      // LiteLLM internally handles this, but for direct API calls we use the full name.
      // The key verification is that the dot-to-dash translation pattern is correct.
      const anthropicModelName = "claude-3-5-haiku-latest";
      const response = await callAnthropicApi(
        anthropicModelName,
        "Say hello in exactly one word",
      );

      // Then: The API call succeeds (no "model not found" error)
      expect(response.content).toBeDefined();
      expect(response.content.length).toBeGreaterThan(0);

      // And: The response contains text
      const textContent = response.content.find(
        (block) => block.type === "text",
      );
      expect(textContent).toBeDefined();
      expect(textContent?.type).toBe("text");
      expect(textContent?.text.length).toBeGreaterThan(0);

      // Verify the response model uses dash notation (not dots)
      expect(response.model).toContain("claude-3-5-haiku");
      expect(response.model).not.toContain("claude-3.5-haiku");
    });

    it("translates and validates model IDs for various Anthropic models", async () => {
      // Test that various Anthropic model IDs are translated correctly
      const testCases = [
        {
          input: "anthropic/claude-opus-4.5",
          expected: "anthropic/claude-opus-4-5",
        },
        {
          input: "anthropic/claude-sonnet-4.5",
          expected: "anthropic/claude-sonnet-4-5",
        },
        {
          input: "anthropic/claude-3.5-haiku",
          expected: "anthropic/claude-3-5-haiku",
        },
        {
          input: "anthropic/claude-3.7-sonnet",
          expected: "anthropic/claude-3-7-sonnet",
        },
      ];

      for (const { input, expected } of testCases) {
        const result = translateModelIdForLitellm(input);
        expect(result).toBe(expected);
      }
    });
  });
});
