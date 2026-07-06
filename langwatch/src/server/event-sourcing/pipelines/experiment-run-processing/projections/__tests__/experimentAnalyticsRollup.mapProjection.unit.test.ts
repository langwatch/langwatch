import { describe, expect, it } from "vitest";
import type { ExperimentRunCompletedEvent } from "../../schemas/events";
import { ExperimentAnalyticsRollupMapProjection } from "../experimentAnalyticsRollup.mapProjection";

const TENANT = "proj-exp-rollup";

function makeCompleted({
  finishedAt,
  stoppedAt,
}: {
  finishedAt?: number | null;
  stoppedAt?: number | null;
}): ExperimentRunCompletedEvent {
  return {
    type: "lw.experiment_run.completed",
    id: "evt-c",
    tenantId: TENANT,
    aggregateId: "run-x",
    occurredAt: 60_000 * 12,
    data: {
      runId: "run-x",
      experimentId: "exp-rollup",
      finishedAt: finishedAt ?? null,
      stoppedAt: stoppedAt ?? null,
    },
  } as unknown as ExperimentRunCompletedEvent;
}

describe("ExperimentAnalyticsRollupMapProjection", () => {
  const proj = new ExperimentAnalyticsRollupMapProjection({
    store: { append: async () => {} },
  });

  describe("given a finished completion", () => {
    it("emits runCount=1, finishedCount=1, stoppedCount=0, mode 'finished'", () => {
      const row = proj.mapExperimentRunCompleted(
        makeCompleted({ finishedAt: 5_000 }),
      );
      expect(row.completionMode).toBe("finished");
      expect(row.runCount).toBe(1);
      expect(row.finishedCount).toBe(1);
      expect(row.stoppedCount).toBe(0);
      expect(row.experimentId).toBe("exp-rollup");
      expect(row.bucketStart.getTime() % 60_000).toBe(0);
    });
  });

  describe("given a stopped completion", () => {
    it("emits stoppedCount=1, mode 'stopped'", () => {
      const row = proj.mapExperimentRunCompleted(
        makeCompleted({ stoppedAt: 5_000 }),
      );
      expect(row.completionMode).toBe("stopped");
      expect(row.stoppedCount).toBe(1);
      expect(row.finishedCount).toBe(0);
    });
  });

  describe("given a completion with neither timestamp", () => {
    it("emits mode 'unknown' with both per-mode counters 0", () => {
      const row = proj.mapExperimentRunCompleted(makeCompleted({}));
      expect(row.completionMode).toBe("unknown");
      expect(row.finishedCount).toBe(0);
      expect(row.stoppedCount).toBe(0);
    });
  });
});
