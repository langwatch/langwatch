/**
 * Integration tests for model ID translation at the LiteLLM boundary.
 *
 * These tests verify that translated model IDs work with actual Anthropic API calls.
 * Skipped when ANTHROPIC_API_KEY is not available.
 *
 * @see specs/model-config/litellm-model-id-translation.feature
 */

import { describe, expect, it } from "vitest";
import { translateModelIdForLitellm } from "../modelIdBoundary";

const apiKey = process.env.ANTHROPIC_API_KEY;

interface AnthropicMessagesResponse {
  id: string;
  type: "message";
  role: "assistant";
  content: Array<{ type: "text"; text: string }>;
  model: string;
  stop_reason: string;
}

function stripProviderPrefix(modelId: string): string {
  const slashIndex = modelId.indexOf("/");
  return slashIndex === -1 ? modelId : modelId.slice(slashIndex + 1);
}

async function callAnthropicApi(model: string): Promise<AnthropicMessagesResponse> {
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
      messages: [{ role: "user", content: "Say hi" }],
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Anthropic API error: ${response.status} - ${errorBody}`);
  }

  return (await response.json()) as AnthropicMessagesResponse;
}

describe("Model ID Boundary - Anthropic API", () => {
  describe.skipIf(!apiKey)("alias expansion", () => {
    it("accepts claude-sonnet-4 translated to claude-sonnet-4-20250514", async () => {
      const translated = translateModelIdForLitellm("anthropic/claude-sonnet-4");
      const modelName = stripProviderPrefix(translated);

      const response = await callAnthropicApi(modelName);

      expect(response.model).toContain("claude-sonnet-4");
    });
  });

  describe.skipIf(!apiKey)("dot-to-dash conversion", () => {
    it("accepts claude-3.5-haiku translated to claude-3-5-haiku-latest", async () => {
      const translated = translateModelIdForLitellm("anthropic/claude-3.5-haiku");
      const modelName = stripProviderPrefix(translated) + "-latest";

      const response = await callAnthropicApi(modelName);

      expect(response.model).toContain("claude-3-5-haiku");
    });
  });
});
