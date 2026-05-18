/**
 * Unit tests for the per-provider seed plan.
 *
 * Pins the contract every provider obeys when its row is enabled at a
 * fresh scope: roles map to specific catalog entries, missing roles
 * stay absent (cascading up to the parent scope rather than
 * defaulting), and provider-specific quirks (Anthropic FAST = sonnet,
 * Anthropic no embeddings, Voyage embeddings-only) hold.
 */
import { describe, expect, it } from "vitest";

import { buildSeedPlanForProvider } from "../seedOnboardingDefaults";

describe("buildSeedPlanForProvider", () => {
  describe("openai", () => {
    /** @scenario OpenAI seed plan populates all three roles */
    it("populates DEFAULT (gpt-X.Y plain), FAST (gpt-X.Y-mini), and EMBEDDINGS", () => {
      const plan = buildSeedPlanForProvider("openai");
      expect(plan.DEFAULT).toMatch(/^openai\/gpt-\d+\.\d+$/);
      expect(plan.FAST).toMatch(/^openai\/gpt-\d+\.\d+-mini$/);
      expect(plan.EMBEDDINGS).toMatch(/^openai\/text-embedding-/);
    });
  });

  describe("anthropic", () => {
    /** @scenario Anthropic FAST defaults to sonnet not haiku */
    it("populates DEFAULT and FAST with the same sonnet model", () => {
      const plan = buildSeedPlanForProvider("anthropic");
      expect(plan.DEFAULT).toMatch(/^anthropic\/claude-sonnet-/);
      expect(plan.FAST).toBe(plan.DEFAULT);
    });

    /** @scenario Anthropic seed plan omits EMBEDDINGS */
    it("leaves EMBEDDINGS unset because Anthropic ships no embedding API", () => {
      const plan = buildSeedPlanForProvider("anthropic");
      expect(plan.EMBEDDINGS).toBeUndefined();
    });
  });

  describe("gemini", () => {
    /** @scenario Gemini DEFAULT prefers pro (incl. -preview) over flash */
    it("populates DEFAULT with a pro (incl. preview) and FAST with a flash variant", () => {
      const plan = buildSeedPlanForProvider("gemini");
      expect(plan.DEFAULT).toMatch(/^gemini\/gemini-\d+\.\d+-pro/);
      expect(plan.FAST).toMatch(/^gemini\/gemini-\d+\.\d+-flash/);
      expect(plan.EMBEDDINGS).toMatch(/^gemini\/gemini-embedding-/);
    });
  });

  describe("voyage", () => {
    /** @scenario Voyage seed plan populates only EMBEDDINGS */
    it("returns EMBEDDINGS only; DEFAULT and FAST stay absent", () => {
      const plan = buildSeedPlanForProvider("voyage");
      expect(plan.EMBEDDINGS).toBe("voyage/voyage-3.5");
      expect(plan.DEFAULT).toBeUndefined();
      expect(plan.FAST).toBeUndefined();
    });
  });

  describe("unknown provider", () => {
    it("returns an empty plan rather than guessing", () => {
      expect(buildSeedPlanForProvider("nonexistent")).toEqual({});
    });
  });
});
