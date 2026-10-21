import { parseProcessConfig } from "@langwatch/config";
import { describe, expect, it } from "vitest";

import { evaluationConfig } from "../evaluation.config.ts";

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

  describe("given a deployment runs no evaluator service", () => {
    /** @scenario "A feature reads its configuration through its own schema" */
    it("boots with no endpoint rather than refusing", () => {
      expect(
        parseProcessConfig({
          owners: [{ name: "evaluation", config: evaluationConfig }],
          environment: {},
        }).evaluation.langevalsEndpoint,
      ).toBeUndefined();
    });
  });
});
