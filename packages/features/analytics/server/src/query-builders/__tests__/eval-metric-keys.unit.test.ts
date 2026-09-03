/**
 * Which evaluation metrics the timeseries builders will serve.
 *
 * This one list is now the source for three things that used to be written
 * separately: the `EvalMetricKey` type, the runtime check both builders guard
 * with, and the route table's rollup-rollable set. Adding a fourth evaluation
 * metric should be one edit.
 *
 * The check is not cosmetic. Both builders THROW when a series names a metric
 * they cannot serve, so a key that routes but fails the check reaches the
 * builder and is refused there — a metric that looks supported right up to the
 * point somebody charts it.
 */

import { describe, expect, it } from "vitest";
import { EVAL_METRIC_KEYS, isEvalMetricKey } from "../shared";

describe("isEvalMetricKey", () => {
  describe("given every key on the list", () => {
    it.each([...EVAL_METRIC_KEYS])("recognises %s", (key) => {
      expect(isEvalMetricKey(key)).toBe(true);
    });

    it("recognises them all, so the check cannot fall behind the list", () => {
      // Written against the list rather than a copy of it: a fourth key added
      // to EVAL_METRIC_KEYS is covered here the moment it is added.
      expect(EVAL_METRIC_KEYS.every((key) => isEvalMetricKey(key))).toBe(true);
    });
  });

  describe("given something else", () => {
    it.each([
      "evaluations.evaluation_bogus",
      "trace.cost",
      "evaluations",
      "",
      "EVALUATIONS.EVALUATION_SCORE",
    ])("refuses %s", (key) => {
      expect(isEvalMetricKey(key)).toBe(false);
    });
  });
});

describe("EVAL_METRIC_KEYS", () => {
  it("names each metric once", () => {
    expect(new Set(EVAL_METRIC_KEYS).size).toBe(EVAL_METRIC_KEYS.length);
  });

  it("is all evaluation metrics, since that is what the name promises", () => {
    expect(EVAL_METRIC_KEYS.every((key) => key.startsWith("evaluations."))).toBe(true);
  });
});
