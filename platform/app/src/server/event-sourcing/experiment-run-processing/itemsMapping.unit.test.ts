import { describe, expect, it } from "vitest";
import {
  generateItemProjectionId,
  mapEvaluatorResult,
  mapTargetResult,
} from "./itemsMapping";
import type { EvaluatorResultData, TargetResultData } from "./schema";

const targetData: TargetResultData = {
  runId: "run-1",
  experimentId: "exp-1",
  index: 0,
  targetId: "t1",
  entry: { question: "why" },
  cost: 0.02,
  duration: 120,
  occurredAt: 1_700_000_000_000,
};

const evaluatorData: EvaluatorResultData = {
  runId: "run-1",
  experimentId: "exp-1",
  index: 0,
  targetId: "t1",
  evaluatorId: "ev1",
  status: "processed",
  score: 0.8,
  passed: true,
  cost: 0.001,
  occurredAt: 1_700_000_000_500,
};

describe("generateItemProjectionId", () => {
  describe("given the same logical item", () => {
    /** @scenario "A repeated item result does not inflate the run" */
    it("re-derives the identical id on every call — a redelivery collapses at merge (ADR-103 decision 2)", () => {
      const args = {
        tenantId: "tenant-1",
        experimentId: "exp-1",
        runId: "run-1",
        index: 0,
        targetId: "t1",
        resultType: "target" as const,
        evaluatorId: null,
      };
      expect(generateItemProjectionId(args)).toBe(
        generateItemProjectionId(args),
      );
    });
  });

  describe("the item-key stability investigation this task asked for", () => {
    it("gives two experiments sharing a runId, index and targetId DIFFERENT ids — the ADR-103 defect this fix closes", () => {
      // ADR-103: "neither the hash nor the sort key includes ExperimentId...
      // two experiments that share a runId... produce item rows with
      // identical sort keys" — `experiment_run_items` sorts
      // `(TenantId, RunId, ProjectionId)`, so two rows with the same
      // ProjectionId collide and one is lost on the next background merge.
      // Confirmed against `IdUtils.generateDeterministicResultId`
      // (event-sourcing.old/.../utils/id.utils.ts): its hash input is
      // `${tenantId}:${runId}:${index}:${targetId}[:${evaluatorId}]:${resultType}`
      // — no `experimentId`. This function folds `experimentId` in, so the
      // two rows below no longer share a `ProjectionId`, and therefore no
      // longer share the sort key that used to collide them.
      const shared = {
        tenantId: "tenant-1",
        runId: "run-1",
        index: 0,
        targetId: "t1",
      };
      const idForExperimentA = generateItemProjectionId({
        ...shared,
        experimentId: "exp-a",
        resultType: "target",
        evaluatorId: null,
      });
      const idForExperimentB = generateItemProjectionId({
        ...shared,
        experimentId: "exp-b",
        resultType: "target",
        evaluatorId: null,
      });
      expect(idForExperimentA).not.toBe(idForExperimentB);
    });

    it("still gives two different targets within the SAME experiment different ids", () => {
      const shared = {
        tenantId: "tenant-1",
        experimentId: "exp-1",
        runId: "run-1",
        index: 0,
      };
      const idForT1 = generateItemProjectionId({
        ...shared,
        targetId: "t1",
        resultType: "target",
        evaluatorId: null,
      });
      const idForT2 = generateItemProjectionId({
        ...shared,
        targetId: "t2",
        resultType: "target",
        evaluatorId: null,
      });
      expect(idForT1).not.toBe(idForT2);
    });

    it("distinguishes a target result from an evaluator result over the same row", () => {
      const shared = {
        tenantId: "tenant-1",
        experimentId: "exp-1",
        runId: "run-1",
        index: 0,
        targetId: "t1",
      };
      const targetId = generateItemProjectionId({
        ...shared,
        resultType: "target",
        evaluatorId: null,
      });
      const evaluatorId = generateItemProjectionId({
        ...shared,
        resultType: "evaluator",
        evaluatorId: "ev1",
      });
      expect(targetId).not.toBe(evaluatorId);
    });
  });

  describe("when the resultType/evaluatorId pairing is invalid", () => {
    it("refuses an evaluator result with no evaluatorId", () => {
      expect(() =>
        generateItemProjectionId({
          tenantId: "t",
          experimentId: "e",
          runId: "r",
          index: 0,
          targetId: "t1",
          resultType: "evaluator",
          evaluatorId: null,
        }),
      ).toThrow();
    });

    it("refuses a target result carrying an evaluatorId", () => {
      expect(() =>
        generateItemProjectionId({
          tenantId: "t",
          experimentId: "e",
          runId: "r",
          index: 0,
          targetId: "t1",
          resultType: "target",
          evaluatorId: "ev1",
        }),
      ).toThrow();
    });
  });
});

describe("mapTargetResult", () => {
  /** @scenario "An item that reports its own cost keeps that figure" */
  it("keeps the cost the item reported itself", () => {
    const record = mapTargetResult({ tenantId: "tenant-1", data: targetData });
    expect(record.targetCost).toBe(0.02);
    expect(record.resultType).toBe("target");
    expect(record.rowIndex).toBe(0);
    expect(record.occurredAt).toBe(targetData.occurredAt);
  });

  /** @scenario "A repeated item result does not inflate the run" */
  it("re-derives the same projectionId for a redelivered event", () => {
    const first = mapTargetResult({ tenantId: "tenant-1", data: targetData });
    const second = mapTargetResult({
      tenantId: "tenant-1",
      data: { ...targetData },
    });
    expect(first.projectionId).toBe(second.projectionId);
  });

  it("clamps a negative duration to zero rather than rejecting it", () => {
    const record = mapTargetResult({
      tenantId: "tenant-1",
      data: { ...targetData, duration: -50 },
    });
    expect(record.targetDurationMs).toBe(0);
  });
});

describe("mapEvaluatorResult", () => {
  it("encodes a passed verdict as 1", () => {
    const record = mapEvaluatorResult({
      tenantId: "tenant-1",
      data: evaluatorData,
    });
    expect(record.passed).toBe(1);
    expect(record.score).toBe(0.8);
    expect(record.resultType).toBe("evaluator");
  });

  it("encodes an unknown verdict as null, not 0", () => {
    const record = mapEvaluatorResult({
      tenantId: "tenant-1",
      data: { ...evaluatorData, passed: undefined },
    });
    expect(record.passed).toBeNull();
  });
});
