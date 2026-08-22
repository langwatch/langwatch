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
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { PersistedEvaluationsV3State } from "~/experiments-v3/types/persistence";
import type { Project } from "~/generated/prisma/client";
import { prisma } from "~/server/db";
import { ExperimentService } from "~/server/experiments/experiment.service";
import { getTestProject } from "~/utils/testUtils";
import type { EvaluationV3Event, ExecutionScope } from "../types";

const orchestratorEvents = vi.hoisted(() => ({
  current: [] as EvaluationV3Event[],
}));

vi.mock("~/server/experiments-v3/execution/orchestrator", () => ({
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
    experiments = ExperimentService.create(prisma);
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

  const runToCompletion = async ({
    experimentId,
    scope,
    service = experiments,
  }: {
    experimentId: string;
    scope: ExecutionScope;
    service?: ExperimentService;
  }) => {
    const started = await startPollingRun({
      projectId: project.id,
      projectSlug: project.slug,
      experimentId,
      experimentSlug: "backend-run",
      scope,
      state: { targets: [{ id: TARGET_ID }] } as never,
      datasetRows: [{ input: "first" }, { input: "second" }],
      datasetColumns: [{ id: "input", name: "input", type: "string" }],
      loadedPrompts: new Map(),
      loadedAgents: new Map(),
      loadedEvaluators: new Map(),
      loadedWorkflows: new Map(),
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
        expect(
          after.state?.results?.evaluatorResults[TARGET_ID]?.[EVALUATOR_ID],
        ).toEqual([
          { status: "processed", score: 1 },
          { status: "processed", score: 0 },
        ]);
        expect(after.version).toBeGreaterThan(version);
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
        expect(
          after.state?.results?.evaluatorResults[TARGET_ID]?.[EVALUATOR_ID],
        ).toEqual([{ status: "processed", score: 1 }, { score: 8 }]);
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
          applyWorkbenchTransform: vi.fn(async () => {
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
});
