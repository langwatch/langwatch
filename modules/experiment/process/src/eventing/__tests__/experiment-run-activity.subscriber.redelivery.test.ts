/**
 * @see modules/experiment/specs/experiment-run-dynamic-concurrency.feature
 */
import { createTenantId } from "@langwatch/eventing";
import type { ExperimentRunPlan } from "@langwatch/experiment-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { ExperimentRunConcurrencyService } from "../../features/run/services/experiment-run-concurrency.service.ts";
import { MemoryExperimentRunActivityRepository } from "../../repositories/memory/memory.experiment-run-activity.repository.ts";
import {
  EXPERIMENT_RUN_EVENT_TYPES,
  EXPERIMENT_RUN_EVENT_VERSIONS,
} from "../../rules/experiment-run-event-types.rules.ts";
import { createExperimentRunActivitySubscriber } from "../experiment-run-activity.subscriber.ts";
import type {
  ExperimentRunCompletedEvent,
  ExperimentRunStartedEvent,
} from "../experiment-run-events.process.ts";

const NOW = 1_800_000_000_000;
const PROJECT = "project_1";

const plan: ExperimentRunPlan = {
  concurrency: 10,
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

const envelope = {
  aggregateId: "experiment_1:run_1",
  aggregateType: "experiment_run",
  tenantId: createTenantId(PROJECT),
  createdAt: NOW,
  occurredAt: NOW,
} as const;

function started(withPlan?: ExperimentRunPlan): ExperimentRunStartedEvent {
  return {
    ...envelope,
    id: "event_started",
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

const completed: ExperimentRunCompletedEvent = {
  ...envelope,
  id: "event_completed",
  type: EXPERIMENT_RUN_EVENT_TYPES.COMPLETED,
  version: EXPERIMENT_RUN_EVENT_VERSIONS.COMPLETED,
  data: { runId: "run_1", experimentId: "experiment_1", outcome: "finished" },
};

function setup() {
  const service = ExperimentRunConcurrencyService.create({
    activity: MemoryExperimentRunActivityRepository.create(),
    config: { runConcurrency: 7, projectCellBudget: 20 },
    now: () => NOW,
  });
  const subscriber = createExperimentRunActivitySubscriber(service);
  const context = createApiFixture<Parameters<typeof subscriber.handle>[1]>({}, "context");
  return {
    service,
    deliver: (event: ExperimentRunStartedEvent | ExperimentRunCompletedEvent) =>
      subscriber.handle(event, context),
  };
}

describe("experimentRunActivity", () => {
  describe("when a planned run's start is delivered twice", () => {
    it("counts the run once", async () => {
      const { service, deliver } = setup();

      await deliver(started(plan));
      await deliver(started(plan));

      expect(await service.resolve({ projectId: PROJECT })).toBe(10);
    });
  });

  describe("when the run's completion is delivered twice", () => {
    /** @scenario "A completed run stops counting" */
    it("stops counting the run and stays stopped", async () => {
      const { service, deliver } = setup();
      await deliver(started(plan));

      await deliver(completed);
      await deliver(completed);

      expect(await service.resolve({ projectId: PROJECT })).toBe(20);
    });
  });

  describe("when a start without a plan is delivered", () => {
    it("counts nothing, since an SDK's run executes no cells here", async () => {
      const { service, deliver } = setup();

      await deliver(started());

      expect(await service.resolve({ projectId: PROJECT })).toBe(20);
    });
  });
});
