import {
  analyticsEvaluationRollupAppendBatchInputSchema,
  analyticsEvaluationRollupAppendInputSchema,
} from "@langwatch/analytics-contract";
import { upsertEvaluationRunCommandSchema } from "@langwatch/evaluation-contract";
import { describe, expect, it } from "vitest";

/**
 * Spec: modules/evaluation/specs/evaluation-run.feature. A tenant kept forever resolves to 0,
 * which the write contracts accept and stamp; only a negative or fractional value is refused.
 */

const rollupRow = {
  tenantId: "tenant-1",
  bucketStart: new Date(0),
  evaluatorType: "langevals/exact_match",
  status: "processed",
  evalCount: 1,
  passCount: 1,
  failCount: 0,
  errorCount: 0,
  skippedCount: 0,
  scoreSum: 1,
  scoreCount: 1,
  durationSum: 1,
  costSum: 0,
  nonBilledCostSum: 0,
};

const writes = (retentionDays: number) => [
  upsertEvaluationRunCommandSchema.safeParse({ tenantId: "t", data: {}, retentionDays }),
  analyticsEvaluationRollupAppendInputSchema.safeParse({ row: rollupRow, retentionDays }),
  analyticsEvaluationRollupAppendBatchInputSchema.safeParse({ rows: [], retentionDays }),
];

describe("Evaluation write retention", () => {
  /** @scenario "A tenant kept indefinitely is stamped with the indefinite sentinel, not refused" */
  it("accepts 0, the indefinite sentinel, on every evaluation write", () => {
    for (const result of writes(0)) {
      expect(result.success).toBe(true);
      expect(result.data?.retentionDays).toBe(0);
    }
  });

  /** @scenario "A negative or fractional retention is refused by name" */
  it.each([-1, 1.5])("refuses %s on every evaluation write", (retentionDays) => {
    for (const result of writes(retentionDays)) {
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.path).toEqual(["retentionDays"]);
    }
  });
});
