import { parseProcessConfig } from "@langwatch/config";
import { describe, expect, it } from "vitest";

import { assertEvaluatorRuntimeConfig, evaluationConfig } from "../evaluation.config.ts";

function resolve(environment: Record<string, string>) {
  return parseProcessConfig({
    owners: [{ name: "evaluation", config: evaluationConfig }],
    environment,
  }).evaluation;
}

describe("evaluation server configuration", () => {
  describe("given a deployment runs no evaluator service", () => {
    /** @scenario "A feature reads its configuration through its own schema" */
    it("boots with no endpoint rather than refusing", () => {
      expect(resolve({}).langevalsEndpoint).toBeUndefined();
    });

    it("routes every evaluator to python", () => {
      expect(resolve({}).evaluatorRuntime).toEqual({
        endpoint: undefined,
        engine: "python",
        engineOverrides: {},
      });
    });
  });

  describe("given per-evaluator engine overrides", () => {
    it("reads one engine per evaluator type", () => {
      const config = resolve({
        EVALUATOR_RUNTIME_ENGINE_OVERRIDES: "langevals/exact_match=go, ragas/faithfulness=shadow",
      });

      expect(config.evaluatorRuntime.engineOverrides).toEqual({
        "langevals/exact_match": "go",
        "ragas/faithfulness": "shadow",
      });
    });

    it("refuses an engine it does not know", () => {
      expect(() =>
        resolve({ EVALUATOR_RUNTIME_ENGINE_OVERRIDES: "langevals/exact_match=rust" }),
      ).toThrow(/Configuration refused/);
    });
  });

  describe("when assertEvaluatorRuntimeConfig checks the Go runtime's address and secret", () => {
    it("accepts python everywhere with neither", () => {
      expect(() =>
        assertEvaluatorRuntimeConfig({ config: resolve({}), internalSecret: undefined }),
      ).not.toThrow();
    });

    it("refuses a Go default engine without its secret, naming it", () => {
      const config = resolve({
        EVALUATOR_RUNTIME_ENGINE: "go",
        EVALUATOR_RUNTIME_ENDPOINT: "http://nlpgo:5561/go/evaluators",
      });

      expect(() => assertEvaluatorRuntimeConfig({ config, internalSecret: undefined })).toThrow(
        /NLPGO_INTERNAL_SECRET is not set/,
      );
    });

    it("refuses a shadowed evaluator without the runtime's address, naming it", () => {
      const config = resolve({
        EVALUATOR_RUNTIME_ENGINE_OVERRIDES: "langevals/exact_match=shadow",
      });

      expect(() => assertEvaluatorRuntimeConfig({ config, internalSecret: "s3cret" })).toThrow(
        /EVALUATOR_RUNTIME_ENDPOINT is not set/,
      );
    });

    it("accepts a Go engine with both", () => {
      const config = resolve({
        EVALUATOR_RUNTIME_ENGINE: "go",
        EVALUATOR_RUNTIME_ENDPOINT: "http://nlpgo:5561/go/evaluators",
      });

      expect(() =>
        assertEvaluatorRuntimeConfig({ config, internalSecret: "s3cret" }),
      ).not.toThrow();
    });
  });
});
