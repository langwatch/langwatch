/**
 * The concurrency claim a pipeline run holds from its resolve: given back while the start command
 * was never sent, kept once it was.
 * @see modules/experiment/specs/experiment-run-dynamic-concurrency.feature
 */
import type { EvaluationV3Event, EvaluationsV3State } from "@langwatch/experiment-contract";
import { createInitialResults, createInitialUIState } from "@langwatch/experiment-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import type { ExperimentRunFoldRepository } from "../../../../repositories/experiment-run-fold.repository.ts";
import { MemoryExperimentRunActivityRepository } from "../../../../repositories/memory/memory.experiment-run-activity.repository.ts";
import { MemoryExperimentRunEventStreamRepository } from "../../../../repositories/memory/memory.experiment-run-event-stream.repository.ts";
import { MemoryExperimentRunFoldRepository } from "../../../../repositories/memory/memory.experiment-run-fold.repository.ts";
import { MemoryExperimentRunAbortRepository } from "../../../../repositories/memory/memory.experiment.repositories.ts";
import type { ExecutionDataServices } from "../../../../services/experiment-execution-data.service.ts";
import type { ExperimentService } from "../../../../services/experiment.service.ts";
import { ExperimentRunConcurrencyService } from "../../../run/services/experiment-run-concurrency.service.ts";
import {
  ExperimentWorkbenchPipelineRunService,
  type PipelineRunStart,
} from "../experiment-workbench-pipeline-run.service.ts";

const PROJECT = "project-claim";
const RUN = "run-claimed";

const state: EvaluationsV3State = {
  name: "Evaluation",
  datasets: [],
  activeDatasetId: "",
  targets: [],
  evaluators: [],
  results: createInitialResults(),
  pendingSavedChanges: {},
  ui: createInitialUIState(),
};

const run: PipelineRunStart = {
  start: {
    tenantId: PROJECT,
    occurredAt: 0,
    runId: RUN,
    experimentId: "",
    workflowVersionId: null,
    total: 1,
    targets: [],
  },
  actor: undefined,
  data: {
    datasetRows: [{ question: "Where is my order?" }],
    datasetColumns: [{ id: "col_1", name: "question", type: "string" }],
    loadedPrompts: new Map(),
    loadedAgents: new Map(),
    loadedEvaluators: new Map(),
    loadedWorkflows: new Map(),
  },
  state,
  carriedOverCells: [],
  reportContext: { projectId: PROJECT },
};

/** A pipeline run over a budget of 24 whose run was claimed when its concurrency was resolved. */
async function claimedRun({
  startFails = false,
  folds = MemoryExperimentRunFoldRepository.create(),
}: {
  startFails?: boolean;
  folds?: ExperimentRunFoldRepository;
}) {
  const concurrency = ExperimentRunConcurrencyService.create({
    activity: MemoryExperimentRunActivityRepository.create(),
    config: { runConcurrency: 10, projectCellBudget: 24 },
  });
  await concurrency.resolve({ projectId: PROJECT, runId: RUN });
  const runs = ExperimentWorkbenchPipelineRunService.create({
    experiments: createApiFixture<ExperimentService>({}, "experiments"),
    observer: { recordExperimentRan: vi.fn(), reportError: vi.fn() },
    runs: {
      commands: {
        startExperimentRun: async () => {
          if (startFails) throw new Error("queue unavailable");
        },
        completeExperimentRun: async () => undefined,
        abortExperimentRun: async () => undefined,
      },
      stream: MemoryExperimentRunEventStreamRepository.create(),
      folds,
      abort: MemoryExperimentRunAbortRepository.create(),
      publicBaseUrl: undefined,
      services: createApiFixture<ExecutionDataServices>({}, "services"),
      ownership: { assertConnectedAgentsRunnable: async () => undefined },
      concurrency,
      refusals: {},
    },
  });
  const nextRunConcurrency = () => concurrency.resolve({ projectId: PROJECT, runId: "next-run" });

  return { runs, nextRunConcurrency };
}

async function framesOf(stream: AsyncGenerator<EvaluationV3Event>): Promise<EvaluationV3Event[]> {
  const frames: EvaluationV3Event[] = [];
  for await (const frame of stream) frames.push(frame);
  return frames;
}

describe("ExperimentWorkbenchPipelineRunService concurrency claim", () => {
  describe("when a streamed run's start command is never sent", () => {
    /** @scenario "A run whose start is never sent gives its claim back" */
    it("ends the stream on an error and gives the claim back", async () => {
      const { runs, nextRunConcurrency } = await claimedRun({ startFails: true });

      const frames = await framesOf(runs.streamRun(run));

      expect(frames).toMatchObject([{ type: "error" }]);
      expect(await nextRunConcurrency()).toBe(24);
    });
  });

  describe("when a polled run's start command is never sent", () => {
    /** @scenario "A run whose start is never sent gives its claim back" */
    it("throws and gives the claim back", async () => {
      const { runs, nextRunConcurrency } = await claimedRun({ startFails: true });

      await expect(runs.startRun(run)).rejects.toThrow("queue unavailable");
      expect(await nextRunConcurrency()).toBe(24);
    });
  });

  describe("when a streamed run fails after its start command was sent", () => {
    /** @scenario "A streamed run that fails after its start was sent keeps its claim" */
    it("ends the stream on an error and keeps the claim until the worker completes it", async () => {
      const { runs, nextRunConcurrency } = await claimedRun({
        folds: createApiFixture<ExperimentRunFoldRepository>(
          { recordRunStart: () => Promise.reject(new Error("fold unavailable")) },
          "folds",
        ),
      });

      const frames = await framesOf(runs.streamRun(run));

      expect(frames).toMatchObject([{ type: "error" }]);
      expect(await nextRunConcurrency()).toBe(12);
    });
  });
});
