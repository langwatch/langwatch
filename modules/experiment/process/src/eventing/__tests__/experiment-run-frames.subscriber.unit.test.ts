import { createTenantId, EventUtils } from "@langwatch/eventing";
import { describe, expect, it } from "vitest";

import type { ExperimentRunProgressState } from "../../repositories/experiment-run-fold.repository.ts";
import { MemoryExperimentRunEventStreamRepository } from "../../repositories/memory/memory.experiment-run-event-stream.repository.ts";
import {
  EXPERIMENT_RUN_EVENT_TYPES,
  EXPERIMENT_RUN_EVENT_VERSIONS,
} from "../../rules/experiment-run-event-types.rules.ts";
import type { CellFinishedEvent } from "../experiment-run-events.process.ts";
import { createExperimentRunFramesSubscriber } from "../experiment-run-frames.subscriber.ts";

const tenantId = createTenantId("project_alpha");
const aggregateId = "experiment_1:run_1";

function cellFinished(): CellFinishedEvent {
  return EventUtils.createEvent<CellFinishedEvent>({
    aggregateType: "experiment_run",
    aggregateId,
    tenantId,
    type: EXPERIMENT_RUN_EVENT_TYPES.CELL_FINISHED,
    version: EXPERIMENT_RUN_EVENT_VERSIONS.CELL_FINISHED,
    data: {
      runId: "run_1",
      experimentId: "experiment_1",
      ordinal: 0,
      phase: 1,
      outcome: "succeeded",
    },
    occurredAt: 2_000,
  });
}

function folded(
  event: CellFinishedEvent,
  overrides: Partial<ExperimentRunProgressState>,
): ExperimentRunProgressState {
  return {
    projectId: "project_alpha",
    runId: "run_1",
    experimentId: "experiment_1",
    planned: true,
    phaseOneCells: 1,
    evaluators: {},
    finishedCells: "AQ==",
    targetOutputs: {},
    traceIds: {},
    evaluatorScores: {},
    experimentSlug: "exp-one",
    status: "running",
    progress: 1,
    total: 1,
    startedAt: 1_000,
    recentEvents: [
      {
        seq: 1,
        eventId: "earlier",
        frame: { type: "execution_started", runId: "run_1", total: 1 },
      },
      { seq: 2, eventId: event.id, frame: { type: "progress", completed: 1, total: 1 } },
    ],
    seq: 2,
    failed: 0,
    persistResults: true,
    resultFrames: {},
    CreatedAt: 0,
    UpdatedAt: 0,
    LastEventOccurredAt: 0,
    ...overrides,
  };
}

describe("the run's frames subscriber", () => {
  describe("when the fold has folded an event of a planned run", () => {
    /** @scenario "A run's live frames are published from its progress fold with their seq" */
    it("publishes only that event's frames, with the seq the fold gave them", async () => {
      const stream = MemoryExperimentRunEventStreamRepository.create();
      const { spec } = createExperimentRunFramesSubscriber({ stream });
      const event = cellFinished();

      await spec.handler(event, { tenantId, aggregateId, state: folded(event, {}) });

      expect(stream.published.get("run_1")).toEqual([
        { seq: 2, frame: { type: "progress", completed: 1, total: 1 } },
      ]);
    });
  });

  describe("when the run has no plan", () => {
    it("publishes nothing, as the old loop streams its own", async () => {
      const stream = MemoryExperimentRunEventStreamRepository.create();
      const { spec } = createExperimentRunFramesSubscriber({ stream });
      const event = cellFinished();

      await spec.handler(event, {
        tenantId,
        aggregateId,
        state: folded(event, { planned: false }),
      });

      expect(stream.published.get("run_1")).toBeUndefined();
    });
  });
});
