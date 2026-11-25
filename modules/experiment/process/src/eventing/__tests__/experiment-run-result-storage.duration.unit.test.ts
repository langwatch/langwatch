/**
 * The duration columns are unsigned integers. A fraction makes ClickHouse
 * reject the whole insert, so the stored row must hold whole milliseconds.
 * @see specs/experiments-v3/execution-backend.feature
 */
import { createTenantId } from "@langwatch/eventing";
import { describe, expect, it } from "vitest";

import {
  EXPERIMENT_RUN_EVENT_TYPES,
  EXPERIMENT_RUN_EVENT_VERSIONS,
} from "../../rules/experiment-run-event-types.rules.ts";
import type { EvaluatorResultEvent, TargetResultEvent } from "../experiment-run-events.process.ts";
import { ExperimentRunResultStorageMapProjection } from "../experiment-run-result-storage.projection.ts";

const projection = ExperimentRunResultStorageMapProjection.create({
  store: { append: async () => undefined },
});

const envelope = {
  id: "evt-1",
  aggregateId: "bold-jolly-bee",
  aggregateType: "experiment_run" as const,
  tenantId: createTenantId("project_test"),
  createdAt: 1_700_000_000_000,
  occurredAt: 1_700_000_000_000,
};

const targetResult = ({ duration }: { duration: number }): TargetResultEvent => ({
  ...envelope,
  type: EXPERIMENT_RUN_EVENT_TYPES.TARGET_RESULT,
  version: EXPERIMENT_RUN_EVENT_VERSIONS.TARGET_RESULT,
  data: {
    runId: "bold-jolly-bee",
    experimentId: "experiment_1",
    index: 0,
    targetId: "target-B",
    entry: { question: "one" },
    predicted: { output: "B one" },
    duration,
  },
});

const verdict = ({ duration }: { duration: number }): EvaluatorResultEvent => ({
  ...envelope,
  type: EXPERIMENT_RUN_EVENT_TYPES.EVALUATOR_RESULT,
  version: EXPERIMENT_RUN_EVENT_VERSIONS.EVALUATOR_RESULT,
  data: {
    runId: "bold-jolly-bee",
    experimentId: "experiment_1",
    index: 0,
    targetId: "target-B",
    evaluatorId: "exact",
    status: "processed",
    passed: true,
    duration,
  },
});

describe("given a result whose duration has a fraction of a millisecond", () => {
  describe("when it is stored", () => {
    /** @scenario "A fractional duration is stored as whole milliseconds" */
    it("rounds the verdict's duration to the nearest whole millisecond", () => {
      const row = projection.mapExperimentRunEvaluatorResult(
        verdict({ duration: 1234.6666666666665 }),
      );
      expect(row.EvaluationDurationMs).toBe(1235);
    });

    /** @scenario "A fractional duration is stored as whole milliseconds" */
    it("rounds the target's duration to the nearest whole millisecond", () => {
      const row = projection.mapExperimentRunTargetResult(
        targetResult({ duration: 812.333333333334 }),
      );
      expect(row.TargetDurationMs).toBe(812);
    });
  });
});

describe("given a result whose duration is negative", () => {
  describe("when it is stored", () => {
    /** @scenario "A fractional duration is stored as whole milliseconds" */
    it("stores zero", () => {
      const row = projection.mapExperimentRunEvaluatorResult(verdict({ duration: -3.5 }));
      expect(row.EvaluationDurationMs).toBe(0);
    });
  });
});
