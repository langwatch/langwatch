import { createTenantId } from "@langwatch/eventing";
import { describe, expect, it } from "vitest";

import { MemoryExperimentRunStateRepository } from "../../repositories/memory/memory.experiment-run-state.repository.ts";
import {
  EXPERIMENT_RUN_EVENT_TYPES,
  EXPERIMENT_RUN_EVENT_VERSIONS,
} from "../../rules/experiment-run-event-types.rules.ts";
import { makeExperimentRunKey } from "../../rules/experiment-run-key.rules.ts";
import type {
  ExperimentRunCompletedEvent,
  ExperimentRunStartedEvent,
} from "../experiment-run-events.process.ts";
import { ExperimentRunStateFoldProjection } from "../experiment-run-state.projection.ts";
import { ExperimentRunStateStore } from "../experiment-run-state.store.ts";

const tenantId = createTenantId("project_alpha");
const aggregateId = makeExperimentRunKey("experiment_1", "run_1");
const run = { runId: "run_1", experimentId: "experiment_1" };

const started: ExperimentRunStartedEvent = {
  id: "event-started",
  aggregateId,
  aggregateType: "experiment_run",
  tenantId,
  createdAt: 1_000,
  occurredAt: 1_000,
  type: EXPERIMENT_RUN_EVENT_TYPES.STARTED,
  version: EXPERIMENT_RUN_EVENT_VERSIONS.STARTED,
  data: { ...run, total: 3, targets: [] },
};

const refused: ExperimentRunCompletedEvent = {
  id: "event-completed",
  aggregateId,
  aggregateType: "experiment_run",
  tenantId,
  createdAt: 2_000,
  occurredAt: 2_000,
  type: EXPERIMENT_RUN_EVENT_TYPES.COMPLETED,
  version: EXPERIMENT_RUN_EVENT_VERSIONS.COMPLETED,
  data: { ...run, outcome: "failed", total: 3, finishedAt: 2_000 },
};

async function storedAfter(events: (ExperimentRunStartedEvent | ExperimentRunCompletedEvent)[]) {
  const repository = MemoryExperimentRunStateRepository.create();
  const projection = ExperimentRunStateFoldProjection.create({
    store: ExperimentRunStateStore.create({ repository }),
  });
  const state = events.reduce(
    (folded, event) => projection.apply(folded, event),
    projection.init(),
  );
  await projection.store.store(state, { aggregateId, tenantId });
  return repository.findProjection(aggregateId, { tenantId });
}

describe("ExperimentRunStateStore.store", () => {
  describe("when a run refused before its start folds only its completion", () => {
    /** @scenario "A run refused before its start leaves no run row" */
    it("stores no row", async () => {
      expect(await storedAfter([refused])).toBeNull();
    });
  });

  describe("when a started run is completed failed", () => {
    /** @scenario "A run refused before its start leaves no run row" */
    it("stores its row", async () => {
      expect((await storedAfter([started, refused]))?.data).toMatchObject({
        RunId: "run_1",
        ExperimentId: "experiment_1",
        Total: 3,
      });
    });
  });
});
