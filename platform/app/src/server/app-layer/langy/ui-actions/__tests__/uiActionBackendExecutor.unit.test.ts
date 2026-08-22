/**
 * The backend half of the UI-action channel: the same transforms the page
 * runs, applied to the SAVED state through the experiment seam
 * (specs/langy/langy-ui-actions-fallback.feature).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WORKBENCH_ACTIONS } from "~/experiments-v3/actions/manifest";
import { StaleWorkbenchStateError } from "~/server/experiments/errors";
import type { ExperimentService } from "~/server/experiments/experiment.service";
import { executeBackendAction } from "../uiActionBackendExecutor";

vi.mock("~/server/experiments-v3/execution/savedStateExecution", () => ({
  prepareSavedStateExecution: vi.fn(),
}));
vi.mock("~/server/experiments-v3/execution/experimentRunner", () => ({
  startPollingRun: vi.fn(),
}));

import { startPollingRun } from "~/server/experiments-v3/execution/experimentRunner";
import { prepareSavedStateExecution } from "~/server/experiments-v3/execution/savedStateExecution";

const CONTEXT = {
  projectId: "project-1",
  projectSlug: "acme",
  userId: "user-1",
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
      const saveCall = vi.mocked(experiments.saveWorkbenchState).mock
        .calls[0]![0];
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
      expect(vi.mocked(experiments.saveWorkbenchState).mock.calls).toHaveLength(
        2,
      );
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
    /** @scenario A run started with no browser executes from the saved state */
    it("starts a polling run and returns its id", async () => {
      const experiments = makeExperiments();
      vi.mocked(prepareSavedStateExecution).mockResolvedValue({
        experiment: { id: "experiment_1", slug: "my-exp" },
        workbenchState: BASE_STATE,
        state: BASE_STATE,
        datasetRows: [{ input: "hi" }],
        datasetColumns: [{ id: "input", name: "input", type: "string" }],
        loadedPrompts: new Map(),
        loadedAgents: new Map(),
        loadedEvaluators: new Map(),
        loadedWorkflows: new Map(),
      } as never);
      vi.mocked(startPollingRun).mockResolvedValue({
        runId: "run-1",
        runUrl: "https://example/run-1",
        total: 1,
      } as never);

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
    });

    /** @scenario A run scoped to a target and a row subset covers only those cells */
    it("keeps both the target and the row filters when the payload carries both", async () => {
      const experiments = makeExperiments();
      vi.mocked(prepareSavedStateExecution).mockResolvedValue({
        experiment: { id: "experiment_1", slug: "my-exp" },
        workbenchState: BASE_STATE,
        state: BASE_STATE,
        datasetRows: [{ input: "hi" }, { input: "again" }],
        datasetColumns: [{ id: "input", name: "input", type: "string" }],
        loadedPrompts: new Map(),
        loadedAgents: new Map(),
        loadedEvaluators: new Map(),
        loadedWorkflows: new Map(),
      } as never);
      vi.mocked(startPollingRun).mockResolvedValue({
        runId: "run-2",
        runUrl: "https://example/run-2",
        total: 2,
      } as never);

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
  });
});
