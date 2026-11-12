/**
 * Durations are stored in integer ClickHouse columns. A fractional value from any
 * producer (an SDK, a computed average) must never reach the insert, or it is refused
 * and the job retries forever.
 */
import { createTenantId } from "@langwatch/eventing";
import { describe, expect, it } from "vitest";

import {
  EXPERIMENT_RUN_EVENT_TYPES,
  EXPERIMENT_RUN_EVENT_VERSIONS,
} from "../../rules/experiment-run-event-types.rules.ts";
import type { EvaluatorResultEvent, TargetResultEvent } from "../experiment-run-events.process.ts";
import { ExperimentRunResultStorageMapProjection } from "../experiment-run-result-storage.projection.ts";
import {
  ExperimentRunStateFoldProjection,
  normalizeDurationMs,
} from "../experiment-run-state.projection.ts";

const TENANT = createTenantId("project_test");

const envelope = {
  id: "evt-1",
  aggregateId: "bold-jolly-bee",
  aggregateType: "experiment_run" as const,
  tenantId: TENANT,
  createdAt: 1_700_000_000_000,
  occurredAt: 1_700_000_000_000,
};

const targetResult = (duration: number, id = "evt-1"): TargetResultEvent => ({
  ...envelope,
  id,
  type: EXPERIMENT_RUN_EVENT_TYPES.TARGET_RESULT,
  version: EXPERIMENT_RUN_EVENT_VERSIONS.TARGET_RESULT,
  data: {
    runId: "bold-jolly-bee",
    experimentId: "experiment_1",
    index: 0,
    targetId: "target-A",
    entry: { question: "q" },
    duration,
  },
});

const verdict = (duration: number): EvaluatorResultEvent => ({
  ...envelope,
  type: EXPERIMENT_RUN_EVENT_TYPES.EVALUATOR_RESULT,
  version: EXPERIMENT_RUN_EVENT_VERSIONS.EVALUATOR_RESULT,
  data: {
    runId: "bold-jolly-bee",
    experimentId: "experiment_1",
    index: 0,
    targetId: "target-A",
    evaluatorId: "exact",
    status: "processed",
    duration,
  },
});

const storage = ExperimentRunResultStorageMapProjection.create({
  store: { append: async () => undefined },
});

describe("normalizeDurationMs", () => {
  it("rounds a fractional duration to whole milliseconds", () => {
    expect(normalizeDurationMs(1234.666666666666)).toBe(1235);
    expect(normalizeDurationMs(1234.4)).toBe(1234);
  });

  it("clamps a negative duration to zero", () => {
    expect(normalizeDurationMs(-0.4)).toBe(0);
    expect(normalizeDurationMs(-25)).toBe(0);
  });

  it("keeps an absent duration absent", () => {
    expect(normalizeDurationMs(null)).toBeNull();
    expect(normalizeDurationMs(undefined)).toBeNull();
  });
});

describe("given a result with a fractional duration", () => {
  describe("when it is stored", () => {
    it("writes whole milliseconds to the target row", () => {
      const row = storage.mapExperimentRunTargetResult(targetResult(812.666666666666));
      expect(row.TargetDurationMs).toBe(813);
    });

    it("writes whole milliseconds to the verdict row", () => {
      const row = storage.mapExperimentRunEvaluatorResult(verdict(812.666666666666));
      expect(row.EvaluationDurationMs).toBe(813);
    });
  });

  describe("when the run's total is folded", () => {
    it("keeps the total duration a whole number", () => {
      const projection = ExperimentRunStateFoldProjection.create({
        store: {
          store: async () => undefined,
          get: async () => ({ kind: "empty" as const }),
        },
      });
      let state = projection.init();
      state = projection.apply(state, targetResult(100.4));
      state = projection.apply(state, targetResult(100.4, "evt-2"));
      expect(state.TotalDurationMs).toBe(200);
    });
  });
});
