import { parseProcessConfig } from "@langwatch/config";
import { describe, expect, it } from "vitest";

import { assertEvaluatorRuntimeConfig, evaluationConfig } from "../evaluation.config.ts";

function resolve(environment: Record<string, string>) {
  return parseProcessConfig({
    owners: [{ name: "evaluation", config: evaluationConfig }],
    environment,
  }).evaluation;
}

const read = (environment: Record<string, string | undefined>) =>
  parseProcessConfig({ owners: [{ name: "evaluation", config: evaluationConfig }], environment })
    .evaluation;

describe("evaluation server configuration", () => {
  describe("given the evaluator inputs byte budgets", () => {
    /**
     * @scenario "The inline threshold and the hard ceiling are deployment settings"
     * @scenario "A feature's defaults are the values a deployment already runs on"
     * @scenario "A setting written the way the previous release read it keeps that meaning"
     */
    it("keeps 1 MiB and 50 MiB unless a positive number is written", () => {
      expect(read({})).toMatchObject({
        inputsInlineMaxBytes: 1024 * 1024,
        inputsHardCeilingBytes: 50 * 1024 * 1024,
      });
      for (const unusable of ["", " ", "0", "0.5", "-5", "lots"]) {
        expect(
          read({
            LANGWATCH_EVAL_INPUTS_INLINE_MAX_BYTES: unusable,
            LANGWATCH_EVAL_INPUTS_HARD_CEILING_BYTES: unusable,
          }),
        ).toMatchObject({
          inputsInlineMaxBytes: 1024 * 1024,
          inputsHardCeilingBytes: 50 * 1024 * 1024,
        });
      }
      expect(
        read({
          LANGWATCH_EVAL_INPUTS_INLINE_MAX_BYTES: "2048.9",
          LANGWATCH_EVAL_INPUTS_HARD_CEILING_BYTES: "4096",
        }),
      ).toMatchObject({ inputsInlineMaxBytes: 2048, inputsHardCeilingBytes: 4096 });
    });
  });

  describe("given the evaluator retry window", () => {
    /** @scenario "An evaluator service that stays down is recorded as an error once the retry window ends" */
    it("is two hours unless the deployment sets fewer minutes, and refuses more than 120", () => {
      expect(read({}).evaluatorRetryWindowMinutes).toBe(120);
      expect(
        read({ LANGWATCH_EVALUATOR_RETRY_WINDOW_MINUTES: "30" }).evaluatorRetryWindowMinutes,
      ).toBe(30);
      expect(() => read({ LANGWATCH_EVALUATOR_RETRY_WINDOW_MINUTES: "121" })).toThrow(
        /LANGWATCH_EVALUATOR_RETRY_WINDOW_MINUTES/,
      );
    });
  });

  describe("given a deployment runs no evaluator service", () => {
    /** @scenario "A feature reads its configuration through its own schema" */
    it("boots with no endpoint rather than refusing", () => {
      expect(resolve({}).langevalsEndpoint).toBeUndefined();
    });

    /** @scenario "With nothing set every evaluator runs on Python" */
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
        EVALUATOR_RUNTIME_ENGINE_OVERRIDES: "ragas/faithfulness=go, langevals/exact_match=shadow",
      });

      expect(config.evaluatorRuntime.engineOverrides).toEqual({
        "ragas/faithfulness": "go",
        "langevals/exact_match": "shadow",
      });
    });

    /** @scenario "An evaluator that makes a model call cannot be put in shadow mode" */
    it("refuses shadow for an evaluator that makes a model call, naming it", () => {
      for (const evaluatorType of [
        "ragas/faithfulness",
        "langevals/similarity",
        "azure/jailbreak",
      ]) {
        expect(() =>
          resolve({ EVALUATOR_RUNTIME_ENGINE_OVERRIDES: `${evaluatorType}=shadow` }),
        ).toThrow(new RegExp(`${evaluatorType}.*makes a model call`));
      }
    });

    /** @scenario "An override for an evaluator the catalogue does not know is refused" */
    it("refuses routing an evaluator the catalogue does not know to Go, naming it", () => {
      expect(() =>
        resolve({ EVALUATOR_RUNTIME_ENGINE_OVERRIDES: "langevals/not_a_real_one=go" }),
      ).toThrow(/langevals\/not_a_real_one/);
    });

    /** @scenario "An override written with more than one engine is refused" */
    it("refuses an entry with more than one engine, naming it", () => {
      expect(() =>
        resolve({ EVALUATOR_RUNTIME_ENGINE_OVERRIDES: "langevals/exact_match=go=shadow" }),
      ).toThrow(/langevals\/exact_match=go=shadow/);
    });

    it("accepts a shadow default engine, which the router narrows per evaluator", () => {
      expect(resolve({ EVALUATOR_RUNTIME_ENGINE: "shadow" }).evaluatorRuntime.engine).toBe(
        "shadow",
      );
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
