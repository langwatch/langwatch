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

const finished = EventUtils.createEvent<CellFinishedEvent>({
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

const progress: ExperimentRunProgressState = {
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
    { seq: 2, eventId: finished.id, frame: { type: "progress", completed: 1, total: 1 } },
  ],
  seq: 2,
  failed: 0,
  persistResults: false,
  resultFrames: {},
  CreatedAt: 0,
  UpdatedAt: 0,
  LastEventOccurredAt: 0,
};

describe("the frames subscriber under redelivery", () => {
  it("republishes the same seq, so a listener that keeps the newest seq shows the frame once", async () => {
    const stream = MemoryExperimentRunEventStreamRepository.create();
    const { spec } = createExperimentRunFramesSubscriber({ stream });

    await spec.handler(finished, { tenantId, aggregateId, state: progress });
    await spec.handler(finished, { tenantId, aggregateId, state: progress });

    const seqs = (stream.published.get("run_1") ?? []).map(({ seq }) => seq);
    expect(new Set(seqs)).toEqual(new Set([2]));
  });
});
