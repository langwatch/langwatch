/**
 * Which evaluation metrics the timeseries builders serve — one list feeding
 * the `EvalMetricKey` type, the runtime check, and the route table, so
 * adding a metric is one edit. Both builders THROW on an unserved metric.
 */

import { describe, expect, it } from "vitest";

import { EVAL_METRIC_KEYS, isEvalMetricKey } from "../clickhouse.timeseries-query-shared.mapper.ts";

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
