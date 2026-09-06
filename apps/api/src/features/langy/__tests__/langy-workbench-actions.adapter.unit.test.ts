/**
 * The saved-document half of Langy's page-action channel, as this process
 * composes it over the experiment run loop
 * (specs/langy/langy-ui-actions-fallback.feature).
 */
import { ExperimentSavedStateExecutionService } from "@langwatch/experiment-server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ApiExperimentRun } from "../../../app/api-experiment-run.composition.ts";
import {
  ApiWorkbenchUiActionBackend,
  type ApiLangyWorkbenchPeer,
} from "../langy-workbench-actions.adapter.ts";

/**
 * A saved board of two columns over two rows, with the first column's cells
 * already filled. It is the shape every assertion below reads: what the run
 * covers, what it carries in, and where its own cells land.
 */
const SAVED_STATE = {
  name: "My experiment",
  activeDatasetId: "dataset-1",
  datasets: [
    {
      id: "dataset-1",
      name: "Dataset",
      type: "inline",
      columns: [{ id: "input", name: "input", type: "string" }],
      inline: {
        columns: [{ id: "input", name: "input", type: "string" }],
        records: { input: ["hi", "again"] },
      },
    },
  ],
  evaluators: [],
  targets: [
    { id: "target-1", type: "prompt", promptId: "prompt_1", inputs: [], outputs: [], mappings: {} },
    { id: "target-2", type: "prompt", promptId: "prompt_2", inputs: [], outputs: [], mappings: {} },
  ],
  results: {
    targetOutputs: { "target-1": ["saved one", "saved two"] },
    targetMetadata: {
      "target-1": [
        { cost: 0.01, duration: 90 },
        { cost: 0.02, duration: 95 },
      ],
    },
    evaluatorResults: {},
    errors: {},
  },
};

type StartRunInput = Parameters<ApiExperimentRun["startRun"]>[0];

function makePeer(): {
  peer: ApiLangyWorkbenchPeer;
  startRun: ReturnType<typeof vi.fn>;
  experiments: ApiLangyWorkbenchPeer["experiments"];
} {
  const experiments = {
    getWorkbenchState: vi.fn(),
    saveWorkbenchState: vi.fn(),
  } as unknown as ApiLangyWorkbenchPeer["experiments"];
  const startRun = vi.fn(async () => ({ runId: "run-1", runUrl: "https://x/run-1", total: 2 }));
  const run = {
    services: {},
    startRun,
    resolveTargetNames: vi.fn(async () => ({})),
  } as unknown as ApiExperimentRun;
  return {
    experiments,
    startRun,
    peer: { experiments, run, trySlugOf: async () => "acme" },
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(ExperimentSavedStateExecutionService, "prepareSavedStateExecution").mockResolvedValue({
    experiment: { id: "experiment_1", slug: "my-exp" },
    workbenchState: SAVED_STATE,
    state: SAVED_STATE,
    datasetRows: [{ input: "hi" }, { input: "again" }],
    datasetColumns: [{ id: "input", name: "input", type: "string" }],
    loadedPrompts: new Map(),
    loadedAgents: new Map(),
    loadedEvaluators: new Map(),
    loadedWorkflows: new Map(),
  } as never);
});

describe("ApiWorkbenchUiActionBackend", () => {
  describe("when a run action falls back to the saved state", () => {
    /** @scenario A run started with no browser covers what the workbench holds */
    it("scopes the run to the payload and carries the board's other cells in", async () => {
      const { peer, startRun } = makePeer();

      const result = await ApiWorkbenchUiActionBackend.create(peer).startRun({
        projectId: "project-1",
        target: "my-exp",
        payload: { targetIds: ["target-2"] },
        actor: { userId: "user-1", label: "langy" },
      });

      expect(result).toEqual({ started: true, runId: "run-1", total: 2 });
      const input = startRun.mock.calls[0]![0] as StartRunInput;
      expect(input.scope).toEqual({ type: "target", targetId: "target-2" });
      expect(input.experimentSlug).toBe("my-exp");
      // Every cell the run does not produce itself comes from the saved board,
      // so opening the run shows the whole workbench rather than one column.
      expect(input.carriedOverCells).toEqual(
        expect.arrayContaining([expect.objectContaining({ targetId: "target-1" })]),
      );
    });

    /** @scenario A run started with no browser fills the cells the workbench shows */
    it("asks the run to write its cells back into the saved state", async () => {
      const { peer, startRun, experiments } = makePeer();

      await ApiWorkbenchUiActionBackend.create(peer).startRun({
        projectId: "project-1",
        target: "my-exp",
        payload: {},
        actor: { userId: "user-1", label: "langy" },
      });

      const input = startRun.mock.calls[0]![0] as StartRunInput;
      expect(input.persistResults?.experiments).toBe(experiments);
      expect(input.persistResults?.actor).toEqual({ userId: "user-1", label: "langy" });
    });

    it("reports the saved document's own refusal instead of starting a run", async () => {
      const { peer, startRun } = makePeer();
      vi.mocked(ExperimentSavedStateExecutionService.prepareSavedStateExecution).mockResolvedValue({
        error: "Experiment has no dataset",
        status: 400,
      });

      const result = await ApiWorkbenchUiActionBackend.create(peer).startRun({
        projectId: "project-1",
        target: "my-exp",
        payload: {},
        actor: { userId: "user-1", label: "langy" },
      });

      expect(result).toEqual({ started: false, refusal: "Experiment has no dataset" });
      expect(startRun).not.toHaveBeenCalled();
    });
  });
});
