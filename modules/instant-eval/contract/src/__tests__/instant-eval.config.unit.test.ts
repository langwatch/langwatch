import { parseProcessConfig } from "@langwatch/config";
import { describe, expect, it } from "vitest";

import { instantEvalConfig, isInstantEvalBounded } from "../instant-eval.config.ts";

const read = (environment: Record<string, string | undefined>) =>
  parseProcessConfig({
    owners: [{ name: "instant-eval", config: instantEvalConfig }],
    environment,
  })["instant-eval"];

describe("instant eval server configuration", () => {
  describe("given a deployment names the memory classifier", () => {
    it("carries it, leaving the production refusal to the judge choice", () => {
      expect(read({ INSTANT_EVAL_CLASSIFIER: "memory" }).classifier).toBe("memory");
    });
  });

  describe("given a deployment that never set INSTANT_EVAL_BOUNDED", () => {
    it("bounds the free budget on the hosted product", () => {
      expect(isInstantEvalBounded(read({ IS_SAAS: "1" }))).toBe(true);
    });

    it("leaves a self-hosted installation unbounded", () => {
      expect(isInstantEvalBounded(read({}))).toBe(false);
    });
  });

  describe("given a deployment that set INSTANT_EVAL_BOUNDED", () => {
    it("lets the hosted product turn the bound off", () => {
      expect(isInstantEvalBounded(read({ IS_SAAS: "1", INSTANT_EVAL_BOUNDED: "false" }))).toBe(
        false,
      );
    });

    it("lets a self-hosted installation turn the bound on", () => {
      expect(isInstantEvalBounded(read({ INSTANT_EVAL_BOUNDED: "true" }))).toBe(true);
    });
  });
});
