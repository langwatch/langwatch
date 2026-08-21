import { describe, expect, it } from "vitest";
import { PROVIDER_ID, buildModelsJson } from "./models.js";
import type { LangyWorkerModelConfig } from "./config.js";

const model: LangyWorkerModelConfig = {
  id: "gpt-5-mini",
  api: "openai-responses",
  baseUrlEnv: "OPENAI_BASE_URL",
  apiKeyEnv: "OPENAI_API_KEY",
  reasoning: true,
  contextWindow: 272000,
  maxTokens: 32000,
  compat: { supportsStore: false },
};

describe("buildModelsJson", () => {
  describe("given the base URL env var is set", () => {
    it("writes the resolved base URL literally and the API key as an env REFERENCE", () => {
      const generated = buildModelsJson(model, {
        OPENAI_BASE_URL: "http://127.0.0.1:41234/v1",
        OPENAI_API_KEY: "sk-secret",
      });
      const provider = generated.providers[PROVIDER_ID] as Record<string, unknown>;
      expect(provider.baseUrl).toBe("http://127.0.0.1:41234/v1");
      expect(provider.api).toBe("openai-responses");
      // The secret itself must never appear: pi resolves $OPENAI_API_KEY at request time.
      expect(provider.apiKey).toBe("$OPENAI_API_KEY");
      expect(JSON.stringify(generated)).not.toContain("sk-secret");
    });

    it("passes model fields (compat included) through verbatim, minus the env pointers", () => {
      const generated = buildModelsJson(
        { ...model, samplingParams: { temperature: 1 } } as LangyWorkerModelConfig,
        { OPENAI_BASE_URL: "http://x", OPENAI_API_KEY: "k" },
      );
      const provider = generated.providers[PROVIDER_ID] as { models: Record<string, unknown>[] };
      const entry = provider.models[0] as Record<string, unknown>;
      expect(entry.id).toBe("gpt-5-mini");
      expect(entry.reasoning).toBe(true);
      expect(entry.contextWindow).toBe(272000);
      expect(entry.maxTokens).toBe(32000);
      expect(entry.compat).toEqual({ supportsStore: false });
      expect(entry.samplingParams).toEqual({ temperature: 1 });
      expect(entry.baseUrlEnv).toBeUndefined();
      expect(entry.apiKeyEnv).toBeUndefined();
    });
  });

  describe("given a missing env var", () => {
    it("fails with the variable name", () => {
      expect(() => buildModelsJson(model, { OPENAI_API_KEY: "k" })).toThrow(/OPENAI_BASE_URL/);
      expect(() => buildModelsJson(model, { OPENAI_BASE_URL: "http://x" })).toThrow(
        /OPENAI_API_KEY/,
      );
    });
  });
});
