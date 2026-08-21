import { describe, expect, it } from "vitest";
import { parseConfig } from "./config.js";

const validConfig = {
  model: {
    id: "gpt-5-mini",
    api: "openai-responses",
    baseUrlEnv: "OPENAI_BASE_URL",
    apiKeyEnv: "OPENAI_API_KEY",
    reasoning: true,
    contextWindow: 272000,
    maxTokens: 32000,
    compat: { supportsStore: false },
  },
  thinkingLevel: "medium",
  personaPrompt: "You are Langy.",
  agentsFilePath: "/home/langy/AGENTS.md",
  skillsDir: "/home/langy/skills",
  sessionDir: "/home/langy/sessions",
};

describe("parseConfig", () => {
  describe("given the full documented shape", () => {
    it("parses it", () => {
      const config = parseConfig(JSON.stringify(validConfig));
      expect(config.model.id).toBe("gpt-5-mini");
      expect(config.model.compat).toEqual({ supportsStore: false });
      expect(config.thinkingLevel).toBe("medium");
    });
  });

  describe("given unknown model keys (future compat findings)", () => {
    it("passes them through", () => {
      const config = parseConfig(
        JSON.stringify({
          ...validConfig,
          model: { ...validConfig.model, samplingParams: { temperature: 1 }, name: "Nice Name" },
        }),
      );
      expect((config.model as Record<string, unknown>).samplingParams).toEqual({ temperature: 1 });
      expect((config.model as Record<string, unknown>).name).toBe("Nice Name");
    });
  });

  describe("given a minimal config", () => {
    it("parses without the optional fields", () => {
      const { thinkingLevel: _t, skillsDir: _s, ...rest } = validConfig;
      const config = parseConfig(
        JSON.stringify({
          ...rest,
          model: {
            id: "m",
            api: "openai-completions",
            baseUrlEnv: "B",
            apiKeyEnv: "K",
          },
        }),
      );
      expect(config.thinkingLevel).toBeUndefined();
      expect(config.skillsDir).toBeUndefined();
    });
  });

  describe("given invalid input", () => {
    it("names the offending field", () => {
      expect(() =>
        parseConfig(JSON.stringify({ ...validConfig, model: { ...validConfig.model, api: "grpc" } })),
      ).toThrow(/model\.api/);
      expect(() => parseConfig(JSON.stringify({ personaPrompt: "x" }))).toThrow(/invalid/);
      expect(() => parseConfig("not json")).toThrow();
    });
  });
});
