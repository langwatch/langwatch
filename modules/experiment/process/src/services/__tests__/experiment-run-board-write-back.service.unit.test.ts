import { createApiFixture } from "@langwatch/api-fixture";
import type {
  ExperimentRunPlan,
  WorkbenchActor,
  WorkbenchStateView,
} from "@langwatch/experiment-contract";
import { describe, expect, it } from "vitest";

import type { ExperimentRunProgressState } from "../../repositories/experiment-run-fold.repository.ts";
import { MemoryExperimentRunFoldRepository } from "../../repositories/memory/memory.experiment-run-fold.repository.ts";
import { createBlankWorkbenchState } from "../../rules/experiment-blank-workbench-state.rules.ts";
import { ExperimentRunBoardWriteBackService } from "../experiment-run-board-write-back.service.ts";
import type { RunResultsPersistence } from "../experiment-run-results-writer.service.ts";

const run = { runId: "run_1", experimentId: "experiment_1" };

const uncredited: ExperimentRunPlan = {
  concurrency: 1,
  origin: "workbench",
  persistResults: true,
  scope: { type: "full" },
  mappingDatasetId: "dataset_1",
  targets: [],
  evaluators: [],
  datasetColumns: [],
  rows: [],
  cells: [],
  pinned: { prompts: [], workflows: [] },
};

const plan: ExperimentRunPlan = { ...uncredited, actor: { userId: "user_1", label: "langy" } };

const progress: ExperimentRunProgressState = {
  projectId: "project_alpha",
  ...run,
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

/** The board as the workbench keeps it: each write bumps the version and says who wrote it. */
function board() {
  let view: WorkbenchStateView = {
    experimentId: "experiment_1",
    slug: "exp-one",
    name: "Experiment one",
    state: createBlankWorkbenchState(),
    version: 1,
    updatedAt: new Date("2026-09-28T10:00:00.000Z"),
  };
  const writers: WorkbenchActor[] = [];
  const experiments = createApiFixture<RunResultsPersistence["experiments"]>(
    {
      getWorkbenchState: async () => view,
      recordWorkbenchRunResults: async ({ results, actor }) => {
        writers.push(actor);
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
  return { experiments, writers, results: () => view.state?.results };
}

async function foldsWith({
  planned = plan,
  folded = progress,
}: {
  planned?: ExperimentRunPlan;
  folded?: ExperimentRunProgressState | null;
} = {}) {
  const folds = MemoryExperimentRunFoldRepository.create();
  await folds.writePlan({
    runKey: "experiment_1:run_1",
    state: {
      projectId: "project_alpha",
      ...run,
      plan: planned,
      CreatedAt: 0,
      UpdatedAt: 0,
      LastEventOccurredAt: 0,
    },
  });
  if (folded) await folds.writeProgress({ state: folded });
  return folds;
}

describe("ExperimentRunBoardWriteBackService.writeBack", () => {
  describe("given a run that writes its cells back and whose fold has every finished cell", () => {
    /** @scenario "A run's cells land on the board before it is completed" */
    it("merges the run's result frames into the board, credited to whoever the plan credits", async () => {
      const { experiments, writers, results } = board();
      const service = ExperimentRunBoardWriteBackService.create({
        folds: await foldsWith(),
        experiments,
      });

      await service.writeBack({ ...run, finishedCells: 1, lastAttempt: false });

      expect(results()?.targetOutputs).toEqual({ target_a: ["4"] });
      expect(writers).toEqual([{ userId: "user_1", label: "langy", runId: "run_1" }]);
    });
  });

  describe("given a plan that credits nobody", () => {
    /** @scenario "A run's cells land on the board before it is completed" */
    it("credits the API, as main did for a key with no person", async () => {
      const { experiments, writers } = board();
      const service = ExperimentRunBoardWriteBackService.create({
        folds: await foldsWith({ planned: uncredited }),
        experiments,
      });

      await service.writeBack({ ...run, finishedCells: 1, lastAttempt: false });

      expect(writers).toEqual([{ label: "api", runId: "run_1" }]);
    });
  });

  describe("given a progress fold that has not folded every finished cell yet", () => {
    /** @scenario "The board write waits until the progress fold has every finished cell" */
    it("throws so the completion is retried, writing nothing", async () => {
      const { experiments, writers } = board();
      const service = ExperimentRunBoardWriteBackService.create({
        folds: await foldsWith(),
        experiments,
      });

      await expect(
        service.writeBack({ ...run, finishedCells: 2, lastAttempt: false }),
      ).rejects.toThrow("not folded yet");
      expect(writers).toEqual([]);
    });

    /** @scenario "The board write waits until the progress fold has every finished cell" */
    it("writes what is folded on the completion's last attempt, so the run still completes", async () => {
      const { experiments, results } = board();
      const service = ExperimentRunBoardWriteBackService.create({
        folds: await foldsWith(),
        experiments,
      });

      await service.writeBack({ ...run, finishedCells: 2, lastAttempt: true });

      expect(results()?.targetOutputs).toEqual({ target_a: ["4"] });
    });
  });

  describe("given a run that keeps its results off the board", () => {
    /** @scenario "A run's cells land on the board before it is completed" */
    it("writes nothing", async () => {
      const { experiments, writers } = board();
      const service = ExperimentRunBoardWriteBackService.create({
        folds: await foldsWith({ planned: { ...plan, persistResults: false }, folded: null }),
        experiments,
      });

      await service.writeBack({ ...run, finishedCells: 1, lastAttempt: false });

      expect(writers).toEqual([]);
    });
  });
});
