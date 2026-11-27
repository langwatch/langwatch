/**
 * @see modules/experiment/specs/experiment-run-recorded-settings.feature
 */
import { createTenantId, type FoldProjectionStore } from "@langwatch/eventing";
import type { ExperimentRunPlan } from "@langwatch/experiment-contract";
import { describe, expect, it } from "vitest";

import {
  EXPERIMENT_RUN_EVENT_TYPES,
  EXPERIMENT_RUN_EVENT_VERSIONS,
} from "../../rules/experiment-run-event-types.rules.ts";
import type { ExperimentRunStartedEvent } from "../experiment-run-events.process.ts";
import {
  type ExperimentRunStateData,
  ExperimentRunStateFoldProjection,
} from "../experiment-run-state.projection.ts";

const store: FoldProjectionStore<ExperimentRunStateData> = {
  store: async () => {},
  get: async () => ({ kind: "empty" as const }),
};
const projection = ExperimentRunStateFoldProjection.create({ store });

const plan: ExperimentRunPlan = {
  concurrency: 1,
  origin: "saved",
  persistResults: false,
  scope: { type: "full" },
  mappingDatasetId: "dataset_1",
  targets: [],
  evaluators: [],
  datasetColumns: [],
  rows: [],
  cells: [],
  pinned: { prompts: [], workflows: [] },
};

function started(withPlan?: ExperimentRunPlan): ExperimentRunStartedEvent {
  return {
    id: "event_1",
    aggregateId: "experiment_1:run_1",
    aggregateType: "experiment_run",
    tenantId: createTenantId("project_1"),
    createdAt: 1000,
    occurredAt: 1000,
    type: EXPERIMENT_RUN_EVENT_TYPES.STARTED,
    version: EXPERIMENT_RUN_EVENT_VERSIONS.STARTED,
    data: {
      runId: "run_1",
      experimentId: "experiment_1",
      total: 0,
      targets: [],
      ...(withPlan ? { plan: withPlan } : {}),
    },
  };
}

describe("the run state's concurrency", () => {
  describe("when the run starts with a plan", () => {
    /** @scenario "The run keeps the concurrency its plan carried" */
    it("holds the plan's concurrency", () => {
      const state = projection.apply(projection.init(), started(plan));

      expect(state.Concurrency).toBe(1);
    });
  });

  describe("when the run starts without a plan", () => {
    /** @scenario "A run started without a plan holds no concurrency" */
    it("holds no concurrency", () => {
      const state = projection.apply(projection.init(), started());

      expect(state.Concurrency).toBeNull();
    });
  });
});
