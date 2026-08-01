import { describe, expect, it } from "vitest";

import {
  computeJudgeIndependence,
  computeVerbosityProfile,
  modelFamily,
} from "../computeJudgeBiasChecks";
import type { BatchResultRow } from "../types";

const row = (
  index: number,
  outputs: Record<string, string | null>,
): BatchResultRow => ({
  index,
  datasetEntry: {},
  targets: Object.fromEntries(
    Object.entries(outputs).map(([targetId, text]) => [
      targetId,
      {
        targetId,
        output: text === null ? null : { output: text },
        cost: null,
        duration: null,
        error: null,
        traceId: null,
        evaluatorResults: [],
      },
    ]),
  ),
});

describe("computeVerbosityProfile", () => {
  describe("given the leader writes far more than the rest", () => {
    /** @scenario "How much longer the winner's answers were is reported" */
    it("reports the ratio of the leader's length to the field's", () => {
      const profile = computeVerbosityProfile({
        variantIds: ["a", "b", "c"],
        rows: [
          row(0, {
            a: "x".repeat(300),
            b: "y".repeat(100),
            c: "z".repeat(100),
          }),
          row(1, {
            a: "x".repeat(300),
            b: "y".repeat(100),
            c: "z".repeat(100),
          }),
        ],
        leaderId: "a",
      });

      expect(profile.leaderMeanLength).toBe(300);
      expect(profile.fieldMeanLength).toBe(100);
      expect(profile.leaderRatio).toBe(3);
    });
  });

  describe("given every variant writes about the same amount", () => {
    /** @scenario "Answer length is reported even when nothing is unusual" */
    it("reports a ratio near one rather than nothing", () => {
      const profile = computeVerbosityProfile({
        variantIds: ["a", "b"],
        rows: [row(0, { a: "x".repeat(100), b: "y".repeat(100) })],
        leaderId: "a",
      });

      expect(profile.leaderRatio).toBe(1);
    });
  });

  describe("when a row errored for one variant", () => {
    it("excludes that row from the variant's mean instead of scoring it zero", () => {
      const rows = [
        row(0, { a: "x".repeat(100), b: "y".repeat(50) }),
        row(1, { a: "x".repeat(100), b: "y".repeat(50) }),
      ];
      rows[1]!.targets.b!.error = "boom";

      const profile = computeVerbosityProfile({
        variantIds: ["a", "b"],
        rows,
        leaderId: "a",
      });

      // b is still 50, not 25 — a failed call is missing data, not a
      // zero-length answer.
      expect(profile.meanLengthByVariant.b).toBe(50);
    });
  });

  describe("when no variant produced measurable output", () => {
    it("reports no ratio rather than dividing by zero", () => {
      const profile = computeVerbosityProfile({
        variantIds: ["a", "b"],
        rows: [row(0, { a: null, b: null })],
        leaderId: "a",
      });

      expect(profile.leaderRatio).toBeNull();
      expect(profile.meanLengthByVariant.a).toBeNull();
    });
  });

  describe("when there is no leader to compare against", () => {
    it("still reports per-variant means but no ratio", () => {
      const profile = computeVerbosityProfile({
        variantIds: ["a", "b"],
        rows: [row(0, { a: "x".repeat(10), b: "y".repeat(20) })],
        leaderId: null,
      });

      expect(profile.leaderRatio).toBeNull();
      expect(profile.meanLengthByVariant.b).toBe(20);
    });
  });
});

describe("modelFamily", () => {
  it("takes the provider segment", () => {
    expect(modelFamily("openai/gpt-5-mini")).toBe("openai");
    expect(modelFamily("Anthropic/claude-sonnet-5")).toBe("anthropic");
  });

  describe("given an id with no provider prefix", () => {
    it("returns null rather than guessing a family from the name", () => {
      expect(modelFamily("gpt-5-mini")).toBeNull();
      expect(modelFamily(null)).toBeNull();
      expect(modelFamily(undefined)).toBeNull();
    });
  });
});

describe("computeJudgeIndependence", () => {
  describe("given a candidate on the judge's own family", () => {
    /** @scenario "A judge that shares a model family with a candidate is disclosed" */
    it("names that candidate", () => {
      const result = computeJudgeIndependence({
        judgeModel: "openai/gpt-5",
        modelByVariant: {
          a: "openai/gpt-5-mini",
          b: "anthropic/claude-sonnet-5",
        },
      });

      expect(result.judgeFamily).toBe("openai");
      expect(result.sharedFamilyVariantIds).toEqual(["a"]);
    });
  });

  describe("given no candidate shares the judge's family", () => {
    it("reports an empty overlap rather than staying silent", () => {
      const result = computeJudgeIndependence({
        judgeModel: "anthropic/claude-sonnet-5",
        modelByVariant: { a: "openai/gpt-5-mini", b: "openai/gpt-5-nano" },
      });

      expect(result.judgeFamily).toBe("anthropic");
      expect(result.sharedFamilyVariantIds).toEqual([]);
    });
  });

  describe("when the judging model was not recorded on the run", () => {
    it("claims no overlap rather than flagging every candidate", () => {
      const result = computeJudgeIndependence({
        judgeModel: null,
        modelByVariant: { a: "openai/gpt-5-mini" },
      });

      expect(result.judgeModel).toBeNull();
      expect(result.judgeFamily).toBeNull();
      expect(result.sharedFamilyVariantIds).toEqual([]);
    });
  });

  describe("when a candidate's model was not recorded", () => {
    it("does not count it as sharing the judge's family", () => {
      const result = computeJudgeIndependence({
        judgeModel: "openai/gpt-5",
        modelByVariant: { a: null, b: undefined },
      });

      expect(result.sharedFamilyVariantIds).toEqual([]);
    });
  });
});
