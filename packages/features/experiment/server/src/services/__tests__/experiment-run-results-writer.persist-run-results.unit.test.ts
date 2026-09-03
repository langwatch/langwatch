/**
 * @see specs/experiments-v3/workbench-versioning.feature
 *
 * `persistRunResults` is the seam both execution paths write through: the
 * polling runner calls it directly when a run completes or stops, and the
 * streaming writer calls it once the last frame arrives. This exercises the
 * merge it performs against the saved workbench state, mocking only the
 * `ExperimentService` persistence boundary — the real fold and merge run.
 */
import { describe, expect, it, vi } from "vitest";
import type { EvaluationV3Event, ExperimentService } from "@langwatch/experiment-contract";
import { applyRunEvent, emptyRunResultsDraft } from "@langwatch/experiment-contract";
import { persistRunResults } from "../experiment-run-results-writer.service";

const TARGET_ID = "target-1";
const EVALUATOR_ID = "evaluator-1";

const cellEvents = ({
  rowIndex,
  output,
  score,
}: {
  rowIndex: number;
  output: string;
  score: number;
}): EvaluationV3Event[] => [
  { type: "cell_started", rowIndex, targetId: TARGET_ID } as never,
  {
    type: "target_result",
    rowIndex,
    targetId: TARGET_ID,
    output: { output },
    cost: 0.02,
    duration: 300,
    traceId: `trace-${rowIndex}`,
  } as never,
  {
    type: "evaluator_result",
    rowIndex,
    targetId: TARGET_ID,
    evaluatorId: EVALUATOR_ID,
    result: { status: "processed", score } as never,
  } as never,
];

const foldedDraft = (events: EvaluationV3Event[]) => {
  const draft = emptyRunResultsDraft();
  for (const event of events) applyRunEvent({ draft, event });
  return draft;
};

const persistenceFor = ({
  savedResults,
}: {
  savedResults?: Record<string, unknown>;
} = {}) => {
  const recordWorkbenchRunResults = vi.fn().mockResolvedValue({ version: 5 });
  const getWorkbenchState = vi.fn().mockResolvedValue({
    experimentId: "experiment_1",
    slug: "my-evaluation",
    version: 4,
    state: { results: savedResults ?? {} },
  });
  const experiments = { getWorkbenchState, recordWorkbenchRunResults } as unknown as
    ExperimentService;
  return { experiments, recordWorkbenchRunResults };
};

describe("given an evaluation whose saved state carries no results", () => {
  describe("when a backend run of every row completes", () => {
    /** @scenario "A completed backend run fills the cells the workbench shows" */
    it("stores each row's output, its metadata and its evaluator results", async () => {
      const { experiments, recordWorkbenchRunResults } = persistenceFor();
      const draft = foldedDraft([
        ...cellEvents({ rowIndex: 0, output: "one", score: 1 }),
        ...cellEvents({ rowIndex: 1, output: "two", score: 0 }),
      ]);

      await persistRunResults({
        persistence: { experiments, actor: { userId: "user_1", label: "user" } },
        projectId: "project_1",
        experimentId: "experiment_1",
        runId: "run-a",
        scope: { type: "full" },
        draft,
      });

      const [call] = recordWorkbenchRunResults.mock.calls;
      const results = call![0].results as Record<string, any>;
      expect(results.targetOutputs[TARGET_ID]).toEqual([{ output: "one" }, { output: "two" }]);
      expect(results.targetMetadata[TARGET_ID]).toEqual([
        { cost: 0.02, duration: 300, traceId: "trace-0" },
        { cost: 0.02, duration: 300, traceId: "trace-1" },
      ]);
      expect(results.evaluatorResults[TARGET_ID]?.[EVALUATOR_ID]).toEqual([
        { status: "processed", score: 1 },
        { status: "processed", score: 0 },
      ]);
    });
  });
});

describe("given an evaluation whose saved state already holds results for every row", () => {
  describe("when a backend run of one row completes", () => {
    /** @scenario "A run of some rows keeps the cells of the rows it did not run" */
    it("refills that row and leaves the other row as it was", async () => {
      const { experiments, recordWorkbenchRunResults } = persistenceFor({
        savedResults: {
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
        },
      });
      const draft = foldedDraft(cellEvents({ rowIndex: 0, output: "fresh", score: 1 }));

      await persistRunResults({
        persistence: { experiments, actor: { userId: "user_1", label: "user" } },
        projectId: "project_1",
        experimentId: "experiment_1",
        runId: "run-b",
        scope: { type: "rows", rowIndices: [0] },
        draft,
      });

      const [call] = recordWorkbenchRunResults.mock.calls;
      const results = call![0].results as Record<string, any>;
      expect(results.targetOutputs[TARGET_ID]).toEqual([{ output: "fresh" }, { output: "keep" }]);
      expect(results.targetMetadata[TARGET_ID]).toEqual([
        { cost: 0.02, duration: 300, traceId: "trace-0" },
        { traceId: "old-1" },
      ]);
      expect(results.evaluatorResults[TARGET_ID]?.[EVALUATOR_ID]).toEqual([
        { status: "processed", score: 1 },
        { score: 8 },
      ]);
    });
  });
});

describe("given a backend run that filled some cells before it was stopped", () => {
  describe("when the run stops", () => {
    /** @scenario "A stopped backend run keeps the cells it already produced" */
    it("writes the cells it produced into the workbench state", async () => {
      const { experiments, recordWorkbenchRunResults } = persistenceFor();
      const draft = foldedDraft(cellEvents({ rowIndex: 0, output: "before the stop", score: 1 }));

      await persistRunResults({
        persistence: { experiments, actor: { userId: "user_1", label: "user" } },
        projectId: "project_1",
        experimentId: "experiment_1",
        runId: "run-stopped",
        scope: { type: "full" },
        draft,
      });

      expect(recordWorkbenchRunResults).toHaveBeenCalledTimes(1);
      const [call] = recordWorkbenchRunResults.mock.calls;
      const results = call![0].results as Record<string, any>;
      expect(results.targetOutputs[TARGET_ID]).toEqual([{ output: "before the stop" }]);
    });
  });
});
