/**
 * Unit tests for the per-provider seed plan.
 *
 * Pins the contract every provider obeys when its row is enabled at a
 * fresh scope: chat providers seed the `{provider}/latest` +
 * `{provider}/latest-mini` aliases (resolver expands at read time),
 * provider-specific quirks (Anthropic no embeddings, Voyage
 * embeddings-only) hold, missing roles stay absent (cascading up to
 * the parent rather than defaulting).
 */
import { describe, expect, it } from "vitest";

import { buildSeedPlanForProvider } from "../seedOnboardingDefaults";

describe("given buildSeedPlanForProvider", () => {
  describe("when the provider is openai", () => {
    /** @scenario OpenAI seed plan uses latest aliases */
    it("populates DEFAULT (openai/latest), FAST (openai/latest-mini), and EMBEDDINGS (pinned)", () => {
      const plan = buildSeedPlanForProvider("openai");
      expect(plan.DEFAULT).toBe("openai/latest");
      expect(plan.FAST).toBe("openai/latest-mini");
      expect(plan.EMBEDDINGS).toMatch(/^openai\/text-embedding-/);
    });
  });

  describe("when the provider is anthropic", () => {
    /** @scenario Anthropic seed plan uses latest aliases */
    it("populates DEFAULT (anthropic/latest) and FAST (anthropic/latest-mini)", () => {
      const plan = buildSeedPlanForProvider("anthropic");
      expect(plan.DEFAULT).toBe("anthropic/latest");
      expect(plan.FAST).toBe("anthropic/latest-mini");
    });

    /** @scenario Anthropic seed plan omits EMBEDDINGS */
    it("leaves EMBEDDINGS unset because Anthropic ships no embedding API", () => {
      const plan = buildSeedPlanForProvider("anthropic");
      expect(plan.EMBEDDINGS).toBeUndefined();
    });
  });

  describe("when the provider is gemini", () => {
    /** @scenario Gemini seed plan uses latest aliases */
    it("populates DEFAULT (gemini/latest), FAST (gemini/latest-mini), and EMBEDDINGS (pinned)", () => {
      const plan = buildSeedPlanForProvider("gemini");
      expect(plan.DEFAULT).toBe("gemini/latest");
      expect(plan.FAST).toBe("gemini/latest-mini");
      expect(plan.EMBEDDINGS).toMatch(/^gemini\/gemini-embedding-/);
    });
  });

  describe("when the provider is voyage", () => {
    /** @scenario Voyage seed plan populates only EMBEDDINGS */
    it("returns EMBEDDINGS only; DEFAULT and FAST stay absent", () => {
      const plan = buildSeedPlanForProvider("voyage");
      expect(plan.EMBEDDINGS).toBe("voyage/voyage-3.5");
      expect(plan.DEFAULT).toBeUndefined();
      expect(plan.FAST).toBeUndefined();
    });
  });

  describe("when the provider is not in the catalog", () => {
    it("returns an empty plan rather than guessing", () => {
      expect(buildSeedPlanForProvider("nonexistent")).toEqual({});
    });
  });
});
