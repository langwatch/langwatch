/**
 * A backend run writes its cells into the saved workbench state.
 *
 * Against real Postgres and the real write seam, because that is the part a
 * mocked service cannot prove: the merged state still passes the workbench
 * schema, the version advances, and a scoped run leaves the rows it did not
 * run exactly as they were.
 *
 * @see specs/experiments-v3/workbench-versioning.feature
 */
import { nanoid } from "nanoid";
import type { ExperimentService } from "@langwatch/experiment-contract";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { EvaluationsV3State } from "~/experiments-v3/types";
import type { PersistedEvaluationsV3State } from "~/experiments-v3/types/persistence";
import type { Project } from "~/generated/prisma/client";
import { prisma } from "~/server/db";
import { getApp } from "~/server/app-layer";
import { getTestProject } from "~/utils/testUtils";
import type { EvaluationV3Event, ExecutionScope } from "../types";

const orchestratorEvents = vi.hoisted(() => ({
  current: [] as EvaluationV3Event[],
}));

// The real cell planner stays in place: the run total the runner publishes is
// counted from it, so a stub would make that count agree with itself.
vi.mock("~/server/experiments-v3/execution/orchestrator", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  runOrchestrator: async function* () {
    for (const event of orchestratorEvents.current) yield event;
  },
  requestAbort: vi.fn(),
}));

import { startPollingRun } from "../experimentRunner";
import { runStateManager } from "../runStateManager";

const TARGET_ID = "target-1";
const EVALUATOR_ID = "evaluator-1";

const savedState = (
  results?: PersistedEvaluationsV3State["results"],
): PersistedEvaluationsV3State =>
  ({
    name: `Backend run ${nanoid(6)}`,
    datasets: [
      {
        id: "dataset-1",
        name: "Inline",
        type: "inline",
        columns: [{ id: "input", name: "input", type: "string" }],
        inline: {
          columns: [{ id: "input", name: "input", type: "string" }],
          records: { input: ["first", "second"] },
        },
      },
    ],
    activeDatasetId: "dataset-1",
    evaluators: [],
    targets: [
      {
        id: TARGET_ID,
        type: "prompt",
        inputs: [{ identifier: "input", type: "str" }],
        outputs: [{ identifier: "output", type: "str" }],
        mappings: {},
      },
    ],
    ...(results ? { results } : {}),
  }) as PersistedEvaluationsV3State;

const cellEvents = ({
  rowIndex,
  output,
  score,
}: {
  rowIndex: number;
  output: string;
  score: number;
}): EvaluationV3Event[] => [
  { type: "cell_started", rowIndex, targetId: TARGET_ID },
  {
    type: "target_result",
    rowIndex,
    targetId: TARGET_ID,
    output: { output },
    cost: 0.02,
    duration: 300,
    traceId: `trace-${rowIndex}`,
  },
  {
    type: "evaluator_result",
    rowIndex,
    targetId: TARGET_ID,
    evaluatorId: EVALUATOR_ID,
    result: { status: "processed", score } as never,
  },
];

const doneEvent = (completedCells: number): EvaluationV3Event => ({
  type: "done",
  summary: {
    runId: "ignored",
    totalCells: completedCells,
    completedCells,
    failedCells: 0,
    duration: 42,
    timestamps: { startedAt: Date.now(), finishedAt: Date.now() },
  },
});

describe("backend run results in the workbench state", () => {
  let project: Project;
  let experiments: ExperimentService;
  const createdIds: string[] = [];

  beforeAll(async () => {
    project = await getTestProject("backend-run-results");
    experiments = getApp().experiments;
  });

  afterAll(async () => {
    await prisma.experimentVersion.deleteMany({
      where: { experimentId: { in: createdIds }, projectId: project.id },
    });
    await prisma.experiment.deleteMany({
      where: { id: { in: createdIds }, projectId: project.id },
    });
  });

  beforeEach(() => {
    orchestratorEvents.current = [];
  });

  const createExperiment = async (
    state: PersistedEvaluationsV3State,
  ): Promise<{ experimentId: string; version: number }> => {
    const created = await experiments.createEvaluationsV3({
      projectId: project.id,
      state,
      actor: { label: "user" },
    });
    createdIds.push(created.experimentId);
    return created;
  };

  /** The state the runner reads: the columns and the dataset it counts over. */
  const runnerState = (targetIds: string[] = [TARGET_ID]) =>
    ({
      datasets: [{ id: "dataset-1" }],
      activeDatasetId: "dataset-1",
      targets: targetIds.map((id) => ({ id, type: "prompt" })),
      evaluators: [],
    }) as unknown as EvaluationsV3State;

  const runToCompletion = async ({
    experimentId,
    scope,
    service = experiments,
    state = runnerState(),
  }: {
    experimentId: string;
    scope: ExecutionScope;
    service?: ExperimentService;
    state?: EvaluationsV3State;
  }) => {
    const started = await startPollingRun({
      projectId: project.id,
      projectSlug: project.slug,
      experimentId,
      experimentSlug: "backend-run",
      scope,
      state,
      datasetRows: [{ input: "first" }, { input: "second" }],
      datasetColumns: [{ id: "input", name: "input", type: "string" }],
      loadedPrompts: new Map(),
      loadedAgents: new Map(),
      loadedEvaluators: new Map(),
      loadedWorkflows: new Map(),
      defaultConcurrency: 10,
      persistResults: {
        experiments: service,
        actor: { label: "api" },
      },
    });
    return started;
  };

  const readState = async (experimentId: string) =>
    await experiments.getWorkbenchState({
      projectId: project.id,
      id: experimentId,
    });

  describe("given an evaluation whose saved state carries no results", () => {
    describe("when a backend run of every row completes", () => {
      /** @scenario A completed backend run fills the cells the workbench shows */
      it("stores each row's output, its metadata and its evaluator results", async () => {
        const { experimentId, version } = await createExperiment(savedState());
        orchestratorEvents.current = [
          { type: "execution_started", runId: "run-a", total: 2 },
          ...cellEvents({ rowIndex: 0, output: "one", score: 1 }),
          ...cellEvents({ rowIndex: 1, output: "two", score: 0 }),
          doneEvent(2),
        ];

        await runToCompletion({ experimentId, scope: { type: "full" } });

        const after = await vi.waitFor(async () => {
          const current = await readState(experimentId);
          expect(current.state?.results?.runId).toBe("run-a");
          return current;
        });

        expect(after.state?.results?.targetOutputs[TARGET_ID]).toEqual([
          { output: "one" },
          { output: "two" },
        ]);
        expect(after.state?.results?.targetMetadata[TARGET_ID]).toEqual([
          { cost: 0.02, duration: 300, traceId: "trace-0" },
          { cost: 0.02, duration: 300, traceId: "trace-1" },
        ]);
        expect(after.state?.results?.evaluatorResults[TARGET_ID]?.[EVALUATOR_ID]).toEqual([
          { status: "processed", score: 1 },
          { status: "processed", score: 0 },
        ]);
        expect(after.version).toBeGreaterThan(version);
      });

      /** @scenario "A version a run wrote names that run" */
      it("names the run on the version it wrote", async () => {
        // What lets a page tell its own run's write from a stranger's. Without
        // it the page that started the run reads the bump as somebody else's,
        // stands autosave down, and asks the reader to reload over edits the
        // run had nothing to do with.
        const { experimentId } = await createExperiment(savedState());
        orchestratorEvents.current = [
          { type: "execution_started", runId: "run-named", total: 1 },
          ...cellEvents({ rowIndex: 0, output: "one", score: 1 }),
          doneEvent(1),
        ];

        const started = await runToCompletion({
          experimentId,
          scope: { type: "full" },
        });

        await vi.waitFor(async () => {
          const current = await readState(experimentId);
          expect(current.state?.results?.runId).toBe("run-named");
          expect(current.runId).toBe(started.runId);
        });
      });
    });
  });

  describe("given an evaluation whose saved state already holds results for every row", () => {
    describe("when a backend run of one row completes", () => {
      /** @scenario A run of some rows keeps the cells of the rows it did not run */
      it("refills that row and leaves the other row as it was", async () => {
        const { experimentId } = await createExperiment(
          savedState({
            runId: "run-before",
            targetOutputs: {
              [TARGET_ID]: [{ output: "old" }, { output: "keep" }],
            },
            targetMetadata: {
              [TARGET_ID]: [{ traceId: "old-0" }, { traceId: "old-1" }],
            },
            evaluatorResults: {
              [TARGET_ID]: { [EVALUATOR_ID]: [{ score: 9 }, { score: 8 }] },
            },
            errors: {},
          }),
        );
        orchestratorEvents.current = [
          { type: "execution_started", runId: "run-b", total: 1 },
          ...cellEvents({ rowIndex: 0, output: "fresh", score: 1 }),
          doneEvent(1),
        ];

        await runToCompletion({
          experimentId,
          scope: { type: "rows", rowIndices: [0] },
        });

        const after = await vi.waitFor(async () => {
          const current = await readState(experimentId);
          expect(current.state?.results?.runId).toBe("run-b");
          return current;
        });

        expect(after.state?.results?.targetOutputs[TARGET_ID]).toEqual([
          { output: "fresh" },
          { output: "keep" },
        ]);
        expect(after.state?.results?.targetMetadata[TARGET_ID]).toEqual([
          { cost: 0.02, duration: 300, traceId: "trace-0" },
          { traceId: "old-1" },
        ]);
        expect(after.state?.results?.evaluatorResults[TARGET_ID]?.[EVALUATOR_ID]).toEqual([
          { status: "processed", score: 1 },
          { score: 8 },
        ]);
      });
    });
  });

  describe("given an evaluation with two columns and two rows", () => {
    describe("when a run names one column and one row", () => {
      it("reports only the cells that run as the run total", async () => {
        const { experimentId } = await createExperiment(savedState());

        const started = await runToCompletion({
          experimentId,
          scope: {
            type: "target-rows",
            targetIds: [TARGET_ID],
            rowIndices: [1],
          },
          state: runnerState([TARGET_ID, "target-2"]),
        });

        expect(started.total).toBe(1);
      });
    });

    describe("when a run names one column and no rows", () => {
      it("reports that column against every row as the run total", async () => {
        const { experimentId } = await createExperiment(savedState());

        const started = await runToCompletion({
          experimentId,
          scope: { type: "target-rows", targetIds: [TARGET_ID] },
          state: runnerState([TARGET_ID, "target-2"]),
        });

        expect(started.total).toBe(2);
      });
    });
  });

  describe("given a saved state that cannot be written", () => {
    describe("when a backend run completes", () => {
      /** @scenario A failure to write the cells back does not fail the run */
      it("still reports the run as completed", async () => {
        const { experimentId } = await createExperiment(savedState());
        orchestratorEvents.current = [
          { type: "execution_started", runId: "run-c", total: 1 },
          ...cellEvents({ rowIndex: 0, output: "one", score: 1 }),
          doneEvent(1),
        ];

        const refusing = {
          recordWorkbenchRunResults: vi.fn(async () => {
            throw new Error("the workbench could not be written");
          }),
        } as unknown as ExperimentService;
        const completeRun = vi.spyOn(runStateManager, "completeRun");

        const { runId } = await runToCompletion({
          experimentId,
          scope: { type: "full" },
          service: refusing,
        });

        await vi.waitFor(() => {
          expect(completeRun).toHaveBeenCalledWith(
            runId,
            expect.objectContaining({ completedCells: 1 }),
          );
        });

        expect(refusing.applyWorkbenchTransform).toHaveBeenCalledTimes(1);
        const after = await readState(experimentId);
        expect(after.state?.results).toBeUndefined();
        completeRun.mockRestore();
      });
    });
  });

  describe("given a backend run that filled some cells before it was stopped", () => {
    describe("when the run stops", () => {
      /** @scenario A stopped backend run keeps the cells it already produced */
      it("writes the cells it produced into the workbench state", async () => {
        const { experimentId, version } = await createExperiment(savedState());
        orchestratorEvents.current = [
          { type: "execution_started", runId: "run-stopped", total: 2 },
          ...cellEvents({ rowIndex: 0, output: "before the stop", score: 1 }),
          { type: "stopped", reason: "user" },
        ];

        await runToCompletion({ experimentId, scope: { type: "full" } });

        const after = await vi.waitFor(async () => {
          const current = await readState(experimentId);
          expect(current.state?.results?.runId).toBe("run-stopped");
          return current;
        });

        expect(after.state?.results?.targetOutputs[TARGET_ID]).toEqual([
          { output: "before the stop" },
        ]);
        expect(after.version).toBeGreaterThan(version);
      });
    });
  });
});
