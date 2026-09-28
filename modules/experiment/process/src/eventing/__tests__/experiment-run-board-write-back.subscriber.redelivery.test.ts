import { createApiFixture } from "@langwatch/api-fixture";
import { createTenantId, EventUtils } from "@langwatch/eventing";
import type { ExperimentRunPlan, WorkbenchStateView } from "@langwatch/experiment-contract";
import { describe, expect, it } from "vitest";

import type { ExperimentRunProgressState } from "../../repositories/experiment-run-fold.repository.ts";
import { MemoryExperimentRunFoldRepository } from "../../repositories/memory/memory.experiment-run-fold.repository.ts";
import { createBlankWorkbenchState } from "../../rules/experiment-blank-workbench-state.rules.ts";
import {
  EXPERIMENT_RUN_EVENT_TYPES,
  EXPERIMENT_RUN_EVENT_VERSIONS,
} from "../../rules/experiment-run-event-types.rules.ts";
import { ExperimentRunBoardWriteBackService } from "../../services/experiment-run-board-write-back.service.ts";
import type { RunResultsPersistence } from "../../services/experiment-run-results-writer.service.ts";
import { createExperimentRunBoardWriteBackSubscriber } from "../experiment-run-board-write-back.subscriber.ts";
import type { ExperimentRunCompletedEvent } from "../experiment-run-events.process.ts";

const tenantId = createTenantId("project_alpha");
const aggregateId = "experiment_1:run_1";

const plan: ExperimentRunPlan = {
  concurrency: 1,
  origin: "workbench",
  persistResults: true,
  actor: { id: "user_1", label: "user" },
  scope: { type: "full" },
  mappingDatasetId: "dataset_1",
  targets: [],
  evaluators: [],
  datasetColumns: [],
  rows: [],
  cells: [],
  pinned: { prompts: [], workflows: [] },
};

const completed = EventUtils.createEvent<ExperimentRunCompletedEvent>({
  aggregateType: "experiment_run",
  aggregateId,
  tenantId,
  type: EXPERIMENT_RUN_EVENT_TYPES.COMPLETED,
  version: EXPERIMENT_RUN_EVENT_VERSIONS.COMPLETED,
  data: { runId: "run_1", experimentId: "experiment_1", finishedAt: 3_000, outcome: "finished" },
  occurredAt: 3_000,
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
  status: "completed",
  progress: 1,
  total: 1,
  startedAt: 1_000,
  finishedAt: 3_000,
  recentEvents: [],
  seq: 3,
  failed: 0,
  persistResults: true,
  resultFrames: {
    "target:0:target_a": { type: "target_result", rowIndex: 0, targetId: "target_a", output: "4" },
  },
  CreatedAt: 0,
  UpdatedAt: 0,
  LastEventOccurredAt: 0,
};

/** The board as the workbench keeps it: each write bumps the version and replaces the results. */
function board() {
  let view: WorkbenchStateView = {
    experimentId: "experiment_1",
    slug: "exp-one",
    name: "Experiment one",
    state: createBlankWorkbenchState(),
    version: 1,
    updatedAt: new Date("2026-09-28T10:00:00.000Z"),
  };
  const experiments = createApiFixture<RunResultsPersistence["experiments"]>(
    {
      getWorkbenchState: async () => view,
      recordWorkbenchRunResults: async ({ results }) => {
        view = {
          ...view,
          state: { ...createBlankWorkbenchState(), results },
          version: view.version + 1,
        };
        return { experimentId: view.experimentId, slug: view.slug, version: view.version };
      },
    },
    "experiments",
  );
  return { experiments, results: () => view.state?.results };
}

describe("the board write-back subscriber under redelivery", () => {
  it("leaves the board's cells as one delivery left them", async () => {
    const folds = MemoryExperimentRunFoldRepository.create();
    await folds.writePlan({
      runKey: aggregateId,
      state: {
        projectId: "project_alpha",
        runId: "run_1",
        experimentId: "experiment_1",
        plan,
        CreatedAt: 0,
        UpdatedAt: 0,
        LastEventOccurredAt: 0,
      },
    });
    const { experiments, results } = board();
    const { spec } = createExperimentRunBoardWriteBackSubscriber({
      boardWriteBack: ExperimentRunBoardWriteBackService.create({ folds, experiments }),
    });

    await spec.handler(completed, { tenantId, aggregateId, state: progress });
    const once = results();
    await spec.handler(completed, { tenantId, aggregateId, state: progress });

    expect(once?.targetOutputs).toEqual({ target_a: ["4"] });
    expect(results()).toEqual(once);
  });
});
