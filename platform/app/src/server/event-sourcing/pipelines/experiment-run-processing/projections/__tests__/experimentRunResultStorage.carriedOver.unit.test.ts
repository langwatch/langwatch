/**
 * @see specs/experiments-v3/run-board-snapshot.feature
 *
 * The stored row is where the difference between a cell the run produced and a
 * cell it copied from the board has to survive. Every reader of the run's money
 * and time keys off this one column.
 */
import { describe, expect, it } from "vitest";
import { createTenantId } from "../../../../domain/tenantId";
import {
  EXPERIMENT_RUN_EVENT_TYPES,
  EXPERIMENT_RUN_EVENT_VERSIONS,
} from "../../schemas/constants";
import type {
  EvaluatorResultEvent,
  TargetResultEvent,
} from "../../schemas/events";
import { ExperimentRunResultStorageMapProjection } from "../experimentRunResultStorage.mapProjection";

const TENANT = createTenantId("project_test");

const projection = new ExperimentRunResultStorageMapProjection({
  store: { append: async () => undefined },
});

const envelope = {
  id: "evt-1",
  aggregateId: "bold-jolly-bee",
  aggregateType: "experiment_run" as const,
  tenantId: TENANT,
  createdAt: 1_700_000_000_000,
  occurredAt: 1_700_000_000_000,
};

const targetResult = (carriedOver?: boolean): TargetResultEvent => ({
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
    cost: 0.3,
    ...(carriedOver !== undefined ? { carriedOver } : {}),
  },
});

const verdict = (carriedOver?: boolean): EvaluatorResultEvent => ({
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
    ...(carriedOver !== undefined ? { carriedOver } : {}),
  },
});

describe("given a result carried into the run from the board", () => {
  describe("when it is stored", () => {
    /** @scenario "A carried-over row is marked as carried over" */
    it("marks the target row as carried over", () => {
      expect(
        projection.mapExperimentRunTargetResult(targetResult(true)).CarriedOver,
      ).toBe(1);
    });

    /** @scenario "A carried-over verdict is marked as carried over" */
    it("marks the verdict row as carried over", () => {
      expect(
        projection.mapExperimentRunEvaluatorResult(verdict(true)).CarriedOver,
      ).toBe(1);
    });
  });
});

describe("given a result the run produced itself", () => {
  describe("when it is stored", () => {
    /** @scenario "A row the run produced is not marked as carried over" */
    it("leaves the target row unmarked", () => {
      expect(
        projection.mapExperimentRunTargetResult(targetResult(false))
          .CarriedOver,
      ).toBe(0);
    });

    /** @scenario "A row the run produced is not marked as carried over" */
    it("leaves a row that says nothing about it unmarked", () => {
      // Rows written before the field existed, and every path that does not
      // carry anything, read back as the run's own work.
      expect(
        projection.mapExperimentRunTargetResult(targetResult()).CarriedOver,
      ).toBe(0);
      expect(
        projection.mapExperimentRunEvaluatorResult(verdict()).CarriedOver,
      ).toBe(0);
    });
  });
});
