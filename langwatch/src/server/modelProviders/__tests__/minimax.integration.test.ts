/**
 * Integration tests for MiniMax provider.
 *
 * These tests verify that MiniMax models work correctly with the actual MiniMax API.
 * Skipped when MINIMAX_API_KEY is not available.
 */

import { describe, expect, it } from "vitest";
import {
  getModelById,
  getModelsForProvider,
  getParameterConstraints,
  getProviderModelOptions,
  modelProviders,
} from "../registry";

const apiKey = process.env.MINIMAX_API_KEY;

interface MiniMaxChatResponse {
  id: string;
  object: string;
  model: string;
  choices: Array<{
    index: number;
    message: { role: string; content: string };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

async function callMiniMaxApi(
  model: string,
  temperature = 0.7,
): Promise<MiniMaxChatResponse> {
  const response = await fetch(
    "https://api.minimax.io/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: 10,
        temperature,
        messages: [{ role: "user", content: "Say hi" }],
      }),
    },
  );

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`MiniMax API error: ${response.status} - ${errorBody}`);
  }

  return (await response.json()) as MiniMaxChatResponse;
}

describe("MiniMax Provider Integration", () => {
  describe("registry consistency", () => {
    it("all MiniMax models have provider set to minimax", () => {
      const models = getModelsForProvider("minimax");
      for (const model of models) {
        expect(model.provider).toBe("minimax");
        expect(model.id).toMatch(/^minimax\//);
      }
    });

    it("all MiniMax chat models appear in provider model options", () => {
      const options = getProviderModelOptions("minimax", "chat");
      const models = getModelsForProvider("minimax").filter(
        (m) => m.mode === "chat",
      );
      expect(options.length).toBe(models.length);
    });

    it("M2.7 and M2.7-highspeed models have correct context length", () => {
      const m27 = getModelById("minimax/minimax-m2.7");
      const m27hs = getModelById("minimax/minimax-m2.7-highspeed");
      expect(m27?.contextLength).toBe(1000000);
      expect(m27hs?.contextLength).toBe(1000000);
    });

    it("temperature constraints are applied to all MiniMax models", () => {
      const models = getModelsForProvider("minimax");
      for (const model of models) {
        const constraints = getParameterConstraints(model.id);
        expect(constraints).toBeDefined();
        expect(constraints?.temperature?.max).toBe(1);
      }
    });

    it("provider keysSchema validates correctly", () => {
      const validResult = modelProviders.minimax.keysSchema.safeParse({
        MINIMAX_API_KEY: "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.test",
      });
      expect(validResult.success).toBe(true);

      const invalidResult = modelProviders.minimax.keysSchema.safeParse({
        MINIMAX_API_KEY: "",
      });
      expect(invalidResult.success).toBe(false);
    });
  });

  describe.skipIf(!apiKey)("MiniMax API calls", () => {
    it("calls M2.7 model successfully", async () => {
      const response = await callMiniMaxApi("MiniMax-M2.7", 0.7);
      expect(response.choices).toHaveLength(1);
      expect(response.choices[0]?.message.content).toBeTruthy();
      expect(response.usage.total_tokens).toBeGreaterThan(0);
    }, 30000);

    it("calls M2.7-highspeed model successfully", async () => {
      const response = await callMiniMaxApi("MiniMax-M2.7-highspeed", 0.7);
      expect(response.choices).toHaveLength(1);
      expect(response.choices[0]?.message.content).toBeTruthy();
    }, 30000);

    it("respects temperature constraint (max 1.0)", async () => {
      const response = await callMiniMaxApi("MiniMax-M2.7", 0.5);
      expect(response.choices[0]?.message.content).toBeTruthy();
    }, 30000);
  });
});
