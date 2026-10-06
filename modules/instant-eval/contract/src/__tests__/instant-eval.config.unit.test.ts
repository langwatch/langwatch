import { ConfigParseError, parseProcessConfig } from "@langwatch/config";
import { describe, expect, it } from "vitest";

import { instantEvalConfig, isInstantEvalBounded } from "../instant-eval.config.ts";

const read = (environment: Record<string, string | undefined>) =>
  parseProcessConfig({
    owners: [{ name: "instant-eval", config: instantEvalConfig }],
    environment,
  })["instant-eval"];

describe("instant eval server configuration", () => {
  describe("given a deployment names no judge origin", () => {
    it("boots without one", () => {
      expect(read({}).classifierBaseUrl).toBeUndefined();
    });
  });

  describe("given a deployment names an https judge origin", () => {
    it("carries it", () => {
      expect(read({ JEV_BASE_URL: "https://judge.example.com" }).classifierBaseUrl).toBe(
        "https://judge.example.com",
      );
    });
  });

  describe("given a deployment names a plaintext judge origin", () => {
    it("refuses to boot, because the judge key would travel in clear", () => {
      expect(() => read({ JEV_BASE_URL: "http://judge.example.com" })).toThrow(ConfigParseError);
      expect(() => read({ JEV_BASE_URL: "http://judge.example.com" })).toThrow(/JEV_BASE_URL/);
    });
  });

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
