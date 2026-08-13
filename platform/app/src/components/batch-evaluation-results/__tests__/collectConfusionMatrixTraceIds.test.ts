import { describe, expect, it } from "vitest";
import {
  CONFUSION_MATRIX_MAX_TRACES,
  collectConfusionMatrixTraceIds,
} from "../collectConfusionMatrixTraceIds";
import type { BatchResultRow } from "../types";

const makeRow = ({
  index,
  targetIds,
}: {
  index: number;
  targetIds: string[];
}): BatchResultRow => ({
  index,
  datasetEntry: {},
  targets: Object.fromEntries(
    targetIds.map((targetId) => [
      targetId,
      {
        targetId,
        output: { output: "some output" },
        cost: 0.001,
        duration: 100,
        error: null,
        traceId: `trace-${index}-${targetId}`,
        evaluatorResults: [],
      },
    ]),
  ),
});

const makeRows = ({
  count,
  targetIds,
}: {
  count: number;
  targetIds: string[];
}): BatchResultRow[] =>
  Array.from({ length: count }, (_, index) => makeRow({ index, targetIds }));

describe("collectConfusionMatrixTraceIds", () => {
  describe("given a run that fits under the cap", () => {
    it("collects one trace id per row per target and covers every row", () => {
      const targetIds = ["target-a", "target-b"];
      const result = collectConfusionMatrixTraceIds({
        rows: makeRows({ count: 10, targetIds }),
        targetIds: new Set(targetIds),
      });

      expect(result.traceIds).toHaveLength(20);
      expect(result.coveredRows).toBe(10);
      expect(result.truncated).toBe(false);
    });

    it("skips targets with no trace id without dropping the row", () => {
      const rows = makeRows({ count: 3, targetIds: ["target-a", "target-b"] });
      rows[1]!.targets["target-b"]!.traceId = null;

      const result = collectConfusionMatrixTraceIds({
        rows,
        targetIds: new Set(["target-a", "target-b"]),
      });

      expect(result.traceIds).toHaveLength(5);
      expect(result.coveredRows).toBe(3);
      expect(result.truncated).toBe(false);
    });
  });

  describe("when the cap falls partway through a row", () => {
    // Three targets does not divide the cap, so the walk stops two targets
    // into a row. Reporting that row as covered would score its remaining
    // targets as "not annotated" even though their annotations were never
    // fetched.
    const targetIds = ["target-a", "target-b", "target-c"];
    const result = collectConfusionMatrixTraceIds({
      rows: makeRows({ count: 400, targetIds }),
      targetIds: new Set(targetIds),
    });

    it("stops at the cap", () => {
      expect(result.traceIds).toHaveLength(CONFUSION_MATRIX_MAX_TRACES);
      expect(result.truncated).toBe(true);
    });

    /** @scenario The capped lookup scores only rows it fetched every target for */
    it("reports only the rows whose every target was fetched", () => {
      expect(result.coveredRows).toBe(
        Math.floor(CONFUSION_MATRIX_MAX_TRACES / targetIds.length),
      );
    });

    /** @scenario The capped lookup scores only rows it fetched every target for */
    it("has fetched a trace id for every target of every covered row", () => {
      const collected = new Set(result.traceIds);
      for (let index = 0; index < result.coveredRows; index++) {
        for (const targetId of targetIds) {
          expect(collected.has(`trace-${index}-${targetId}`)).toBe(true);
        }
      }
    });
  });

  describe("when the cap falls exactly on a row boundary", () => {
    it("counts that row as covered", () => {
      const targetIds = ["target-a", "target-b"];
      const result = collectConfusionMatrixTraceIds({
        rows: makeRows({ count: 400, targetIds }),
        targetIds: new Set(targetIds),
      });

      expect(result.traceIds).toHaveLength(CONFUSION_MATRIX_MAX_TRACES);
      expect(result.truncated).toBe(true);
      expect(result.coveredRows).toBe(
        CONFUSION_MATRIX_MAX_TRACES / targetIds.length,
      );
    });
  });
});
