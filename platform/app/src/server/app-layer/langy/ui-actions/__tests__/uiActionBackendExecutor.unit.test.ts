/**
 * The backend half of the UI-action channel: the same transforms the page
 * runs, applied to the SAVED state through the experiment seam
 * (specs/langy/langy-ui-actions-fallback.feature).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WORKBENCH_ACTIONS } from "~/experiments-v3/actions/manifest";
import { StaleWorkbenchStateError, type ExperimentService } from "@langwatch/experiment-contract";
import { executeBackendAction } from "../uiActionBackendExecutor";

vi.mock(
  import("~/server/experiments-v3/execution/savedStateExecution"),
  async (importOriginal) => ({
    ...(await importOriginal()),
    prepareSavedStateExecution: vi.fn(),
  }),
);
vi.mock("~/server/experiments-v3/execution/experimentRunner", () => ({
  startPollingRun: vi.fn(),
}));
// Resolving column names reaches the prompt, agent and evaluator rows. The
// projection's fallback covers what cannot be resolved, and this suite is about
// the executor rather than about the names.
vi.mock("~/server/experiments-v3/workbenchTargetNames", () => ({
  resolveWorkbenchTargetNames: vi.fn().mockResolvedValue({}),
}));

import { startPollingRun } from "~/server/experiments-v3/execution/experimentRunner";
import { prepareSavedStateExecution } from "~/server/experiments-v3/execution/savedStateExecution";

const CONTEXT = {
  projectId: "project-1",
  projectSlug: "acme",
  userId: "user-1",
  evaluationDefaultConcurrency: 10,
  experimentSlug: "my-exp",
};

const BASE_STATE = {
  name: "My experiment",
  datasets: [
    {
      id: "dataset-1",
      name: "Dataset",
      type: "inline",
      columns: [
        { id: "input", name: "input", type: "string" },
        { id: "expected_output", name: "expected_output", type: "string" },
      ],
      inline: {
        columns: [
          { id: "input", name: "input", type: "string" },
          { id: "expected_output", name: "expected_output", type: "string" },
        ],
        records: { input: ["hi"], expected_output: ["hello"] },
      },
    },
  ],
  activeDatasetId: "dataset-1",
  evaluators: [],
  targets: [
    {
      id: "target-1",
      type: "prompt",
      promptId: "prompt_1",
      inputs: [{ identifier: "input", type: "str" }],
      outputs: [{ identifier: "output", type: "str" }],
      mappings: {},
    },
  ],
};

function makeExperiments({
  saveError,
}: {
  saveError?: Error;
} = {}): ExperimentService & {
  saves: Array<{ expectedVersion?: number; commitMessage?: string }>;
} {
  let version = 4;
  const saves: Array<{ expectedVersion?: number; commitMessage?: string }> = [];
  let failNext = saveError;
  return {
    saves,
    getWorkbenchState: vi.fn(async () => ({
      experimentId: "experiment_1",
      slug: "my-exp",
      name: "My experiment",
      state: structuredClone(BASE_STATE),
      version,
      updatedAt: new Date(),
    })),
    saveWorkbenchState: vi.fn(
      async ({
        expectedVersion,
        commitMessage,
      }: {
        expectedVersion?: number;
        commitMessage?: string;
      }) => {
        if (failNext) {
          const error = failNext;
          failNext = undefined;
          throw error;
        }
        saves.push({ expectedVersion, commitMessage });
        version += 1;
        return { experimentId: "experiment_1", slug: "my-exp", version };
      },
    ),
  } as unknown as ExperimentService & {
    saves: Array<{ expectedVersion?: number; commitMessage?: string }>;
  };
}

/**
 * Arrange the saved-state execution and the run it starts.
 *
 * One shape, not three: `prepareSavedStateExecution` returns a wide record, and
 * three hand-copied literals of it drift the moment it gains a field — each
 * copy then pins a different idea of what the executor is handed.
 */
function mockSavedStateRun({
  datasetRows,
  runId,
}: {
  datasetRows: Array<Record<string, string>>;
  runId: string;
}): void {
  vi.mocked(prepareSavedStateExecution).mockResolvedValue({
    experiment: { id: "experiment_1", slug: "my-exp" },
    workbenchState: BASE_STATE,
    state: BASE_STATE,
    datasetRows,
    datasetColumns: [{ id: "input", name: "input", type: "string" }],
    loadedPrompts: new Map(),
    loadedAgents: new Map(),
    loadedEvaluators: new Map(),
    loadedWorkflows: new Map(),
  } as never);
  vi.mocked(startPollingRun).mockResolvedValue({
    runId,
    runUrl: `https://example/${runId}`,
    total: datasetRows.length,
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("executeBackendAction", () => {
  describe("when the dispatch names no experiment", () => {
    /** @scenario A backend fallback without the experiment named is refused */
    it("refuses with langy_ui_experiment_required", async () => {
      const experiments = makeExperiments();
      await expect(
        executeBackendAction({
          experiments,
          context: { ...CONTEXT, experimentSlug: undefined },
          kind: "workbench.duplicateTarget",
          definition: WORKBENCH_ACTIONS["workbench.duplicateTarget"],
          payload: { targetId: "target-1" },
        }),
      ).rejects.toMatchObject({ code: "langy_ui_experiment_required" });
    });
  });

  describe("when a transform action runs against the saved state", () => {
    /** @scenario A backend edit lands as a version attributed to Langy */
    it("saves through the seam at the version it read and returns the transform result", async () => {
      const experiments = makeExperiments();
      const result = (await executeBackendAction({
        experiments,
        context: CONTEXT,
        kind: "workbench.duplicateTarget",
        definition: WORKBENCH_ACTIONS["workbench.duplicateTarget"],
        payload: { targetId: "target-1" },
      })) as { targetId: string; version: number };

      expect(result.targetId).toMatch(/^target-/);
      expect(result.targetId).not.toBe("target-1");
      expect(result.version).toBe(5);
      expect(experiments.saves).toEqual([
        {
          expectedVersion: 4,
          commitMessage: "Applied workbench.duplicateTarget",
        },
      ]);
      const saveCall = vi.mocked(experiments.saveWorkbenchState).mock.calls[0]![0];
      expect(saveCall.actor).toEqual({ userId: "user-1", label: "langy" });
    });

    it("retries once when a concurrent writer made the read stale", async () => {
      const experiments = makeExperiments({
        saveError: new StaleWorkbenchStateError({ currentVersion: 5 }),
      });
      const result = (await executeBackendAction({
        experiments,
        context: CONTEXT,
        kind: "workbench.duplicateTarget",
        definition: WORKBENCH_ACTIONS["workbench.duplicateTarget"],
        payload: { targetId: "target-1" },
      })) as { version: number };

      expect(result.version).toBeGreaterThan(4);
      expect(vi.mocked(experiments.saveWorkbenchState).mock.calls).toHaveLength(2);
    });

    it("maps a transform refusal to langy_ui_handler_failed with the code", async () => {
      const experiments = makeExperiments();
      await expect(
        executeBackendAction({
          experiments,
          context: CONTEXT,
          kind: "workbench.duplicateTarget",
          definition: WORKBENCH_ACTIONS["workbench.duplicateTarget"],
          payload: { targetId: "no-such-target" },
        }),
      ).rejects.toMatchObject({
        code: "langy_ui_handler_failed",
        // The agent named a target the saved state does not have, so the
        // refusal is the caller's to fix, not an incident.
        fault: "customer",
        meta: expect.objectContaining({ errorCode: "target_not_found" }),
      });
      expect(experiments.saves).toHaveLength(0);
    });
  });

  describe("when the read action falls back to the saved state", () => {
    /** @scenario get-state falls back to the saved state when no browser is attached */
    it("marks the projection as coming from the saved document", async () => {
      const experiments = makeExperiments();
      const result = (await executeBackendAction({
        experiments,
        context: CONTEXT,
        kind: "workbench.getState",
        definition: WORKBENCH_ACTIONS["workbench.getState"],
        payload: {},
      })) as { source: string; version: number; name: string };

      expect(result.source).toBe("saved");
      expect(result.version).toBe(4);
      expect(result.name).toBe("My experiment");
    });
  });

  describe("when the run action falls back to the saved state", () => {
    /** @scenario A run started with no browser covers what the workbench holds */
    it("starts a polling run and returns its id", async () => {
      const experiments = makeExperiments();
      mockSavedStateRun({ datasetRows: [{ input: "hi" }], runId: "run-1" });

      const result = (await executeBackendAction({
        experiments,
        context: CONTEXT,
        kind: "workbench.run",
        definition: WORKBENCH_ACTIONS["workbench.run"],
        payload: { rowIndices: [0] },
      })) as { runId: string; status: string };

      expect(result).toEqual({ runId: "run-1", status: "running", total: 1 });
      const scope = vi.mocked(startPollingRun).mock.calls[0]![0].scope;
      expect(scope).toEqual({ type: "rows", rowIndices: [0] });
      expect(vi.mocked(startPollingRun).mock.calls[0]![0].defaultConcurrency).toBe(10);
    });

    /** @scenario A run started with no browser fills the cells the workbench shows */
    it("asks the run to write its cells back into the saved state", async () => {
      const experiments = makeExperiments();
      mockSavedStateRun({ datasetRows: [{ input: "hi" }], runId: "run-3" });

      await executeBackendAction({
        experiments,
        context: CONTEXT,
        kind: "workbench.run",
        definition: WORKBENCH_ACTIONS["workbench.run"],
        payload: {},
      });

      const { persistResults } = vi.mocked(startPollingRun).mock.calls[0]![0];
      expect(persistResults?.experiments).toBe(experiments);
      expect(persistResults?.actor).toEqual({
        userId: "user-1",
        label: "langy",
      });
    });

    /** @scenario A run scoped to a target and a row subset covers only those cells */
    it("keeps both the target and the row filters when the payload carries both", async () => {
      const experiments = makeExperiments();
      mockSavedStateRun({
        datasetRows: [{ input: "hi" }, { input: "again" }],
        runId: "run-2",
      });

      await executeBackendAction({
        experiments,
        context: CONTEXT,
        kind: "workbench.run",
        definition: WORKBENCH_ACTIONS["workbench.run"],
        payload: { targetIds: ["target-1"], rowIndices: [0, 1] },
      });

      const scope = vi.mocked(startPollingRun).mock.calls[0]![0].scope;
      expect(scope).toEqual({
        type: "target-rows",
        targetIds: ["target-1"],
        rowIndices: [0, 1],
      });
    });

    /**
     * A run with no browser attached starts from a state whose results are
     * empty by construction. Without the saved cells, a comparison judging the
     * scoped column against another one finds no output for that other column
     * and reports every row as waiting on it.
     */
    describe("given a comparison over the scoped column and another one", () => {
      const comparisonState = () => ({
        ...structuredClone(BASE_STATE),
        targets: [
          ...structuredClone(BASE_STATE).targets,
          {
            id: "target-2",
            type: "prompt",
            promptId: "prompt_2",
            inputs: [{ identifier: "input", type: "str" }],
            outputs: [{ identifier: "output", type: "str" }],
            mappings: {},
          },
        ],
        evaluators: [
          {
            id: "evaluator_compare",
            evaluatorType: "langevals/select_best_compare",
            inputs: [],
            mappings: {},
            comparison: {
              variants: ["target-1", "target-2"],
              hasGoldenAnswer: true,
              goldenField: "expected_output",
              includeMetrics: [],
              randomizeOrder: true,
            },
          },
        ],
        results: {
          targetOutputs: { "target-1": ["saved baseline"] },
          targetMetadata: { "target-1": [{ cost: 0.01, duration: 90 }] },
          evaluatorResults: {},
          errors: {},
        },
      });

      /** @scenario "Running one candidate keeps the comparison's other columns" */
      it("seeds the other column's saved output into the run", async () => {
        const experiments = makeExperiments();
        const state = comparisonState();
        vi.mocked(prepareSavedStateExecution).mockResolvedValue({
          experiment: { id: "experiment_1", slug: "my-exp" },
          workbenchState: state,
          state,
          datasetRows: [{ input: "hi" }],
          datasetColumns: [{ id: "input", name: "input", type: "string" }],
          loadedPrompts: new Map(),
          loadedAgents: new Map(),
          loadedEvaluators: new Map(),
          loadedWorkflows: new Map(),
        } as never);
        vi.mocked(startPollingRun).mockResolvedValue({
          runId: "run-3",
          runUrl: "https://example/run-3",
          total: 1,
        } as never);

        await executeBackendAction({
          experiments,
          context: CONTEXT,
          kind: "workbench.run",
          definition: WORKBENCH_ACTIONS["workbench.run"],
          payload: { targetIds: ["target-2"] },
        });

        expect(vi.mocked(startPollingRun).mock.calls[0]![0].seedTargetOutputs).toEqual({
          "0:target-1": { output: "saved baseline", cost: 0.01, duration: 90 },
        });
      });
    });
  });
});
