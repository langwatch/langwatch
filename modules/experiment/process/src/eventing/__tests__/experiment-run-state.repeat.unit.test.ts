/**
 * @see specs/experiments-v3/run-repeat.feature
 */
import { createTenantId, type FoldProjectionStore } from "@langwatch/eventing";
import { experimentRunTargetSchema, type ExperimentRunPlan } from "@langwatch/experiment-contract";
import { describe, expect, it } from "vitest";

import {
  EXPERIMENT_RUN_EVENT_TYPES,
  EXPERIMENT_RUN_EVENT_VERSIONS,
} from "../../rules/experiment-run-event-types.rules.ts";
import {
  storedRunRepeatOf,
  runTargetFromStored,
} from "../../rules/experiment-run-stored-target.rules.ts";
import type {
  ExperimentRunStartedEvent,
  TargetResultEvent,
} from "../experiment-run-events.process.ts";
import {
  type ExperimentRunStateData,
  ExperimentRunStateFoldProjection,
} from "../experiment-run-state.projection.ts";

const store: FoldProjectionStore<ExperimentRunStateData> = {
  store: async () => {},
  get: async () => ({ kind: "empty" as const }),
};
const projection = ExperimentRunStateFoldProjection.create({ store });

const plan = (repeat?: number): ExperimentRunPlan => ({
  concurrency: 1,
  ...(repeat !== undefined ? { repeat } : {}),
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
});

const target = { id: "target_a", name: "support-prompt", type: "prompt", metadata: { tier: "a" } };

function started(repeat?: number): ExperimentRunStartedEvent {
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
      total: 6,
      targets: [target],
      plan: plan(repeat),
    },
  };
}

const readTargets = (state: ExperimentRunStateData): unknown => JSON.parse(state.Targets);

describe("the run state's repeat", () => {
  describe("when the run starts with a plan whose repeat is 3", () => {
    /** @scenario "The run keeps the repeat its plan carried" */
    it("reads back a repeat of 3", () => {
      const state = projection.apply(projection.init(), started(3));

      expect(storedRunRepeatOf(readTargets(state))).toBe(3);
    });

    /** @scenario "The run keeps the repeat its plan carried" */
    it("reads its targets without the stored repeat in their metadata", () => {
      const state = projection.apply(projection.init(), started(3));
      const [stored] = readTargets(state) as { id: string }[];

      expect(experimentRunTargetSchema.parse(runTargetFromStored(stored!))).toEqual(target);
    });

    /** @scenario "The run keeps the repeat its plan carried" */
    it("keeps the repeat when a later result restates the target without it", () => {
      const afterStart = projection.apply(projection.init(), started(3));
      const result: TargetResultEvent = {
        id: "event_2",
        aggregateId: "experiment_1:run_1",
        aggregateType: "experiment_run",
        tenantId: createTenantId("project_1"),
        createdAt: 2000,
        occurredAt: 2000,
        type: EXPERIMENT_RUN_EVENT_TYPES.TARGET_RESULT,
        version: EXPERIMENT_RUN_EVENT_VERSIONS.TARGET_RESULT,
        data: {
          runId: "run_1",
          experimentId: "experiment_1",
          index: 0,
          targetId: "target_a",
          entry: {},
          targets: [target],
        },
      };

      const state = projection.apply(afterStart, result);

      expect(storedRunRepeatOf(readTargets(state))).toBe(3);
    });
  });

  describe("when the run starts with no repeat", () => {
    /** @scenario "The run keeps the repeat its plan carried" */
    it("reads no repeat", () => {
      const state = projection.apply(projection.init(), started());

      expect(storedRunRepeatOf(readTargets(state))).toBe(1);
    });
  });
});
