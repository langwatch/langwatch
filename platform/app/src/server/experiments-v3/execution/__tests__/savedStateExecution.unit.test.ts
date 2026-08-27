/**
 * A run started with no browser attached reads the saved workbench state and
 * executes it. The dataset it picks has to be the one the workbench has
 * selected, because the customer sees that dataset on screen and the results
 * are written back against it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PersistedEvaluationsV3State } from "~/experiments-v3/types/persistence";

const findBySlugAndType = vi.hoisted(() => vi.fn());
const loadExecutionData = vi.hoisted(() => vi.fn());

vi.mock("~/server/db", () => ({ prisma: {} }));
vi.mock("../dataLoader", () => ({ loadExecutionData }));

import { buildStateFromWorkbench, prepareSavedStateExecution } from "../savedStateExecution";

const datasetNamed = (id: string) => ({
  id,
  name: `Dataset ${id}`,
  type: "inline" as const,
  columns: [{ id: "input", name: "input", type: "string" }],
  inline: {
    columns: [{ id: "input", name: "input", type: "string" }],
    records: { input: [`row for ${id}`] },
  },
});

const twoDatasetState = (activeDatasetId: string) =>
  ({
    name: "Two datasets",
    datasets: [datasetNamed("dataset-1"), datasetNamed("dataset-2")],
    activeDatasetId,
    evaluators: [],
    targets: [],
  }) as unknown as PersistedEvaluationsV3State;

beforeEach(() => {
  findBySlugAndType.mockReset();
  loadExecutionData.mockReset();
  loadExecutionData.mockResolvedValue({
    datasetRows: [],
    datasetColumns: [],
    loadedPrompts: new Map(),
    loadedAgents: new Map(),
    loadedEvaluators: new Map(),
    loadedWorkflows: new Map(),
  });
});

describe("buildStateFromWorkbench", () => {
  describe("given the second dataset is the active one", () => {
    it("keeps that dataset selected", () => {
      const state = buildStateFromWorkbench(twoDatasetState("dataset-2"));

      expect(state.activeDatasetId).toBe("dataset-2");
      expect(state.datasets.map((dataset) => dataset.id)).toEqual(["dataset-1", "dataset-2"]);
    });
  });
});

describe("prepareSavedStateExecution", () => {
  describe("given a saved workbench whose second dataset is active", () => {
    beforeEach(() => {
      findBySlugAndType.mockResolvedValue({
        id: "experiment_1",
        slug: "two-datasets",
        workbenchState: twoDatasetState("dataset-2"),
      });
    });

    it("loads the active dataset instead of the first one", async () => {
      await prepareSavedStateExecution({
        projectId: "project_1",
        slug: "two-datasets",
      });

      expect(loadExecutionData).toHaveBeenCalledTimes(1);
      expect(loadExecutionData.mock.calls[0]?.[0]?.dataset?.id).toBe("dataset-2");
    });

    it("hands the orchestrator a state still pointing at that dataset", async () => {
      const prepared = await prepareSavedStateExecution({
        projectId: "project_1",
        slug: "two-datasets",
      });

      expect("state" in prepared).toBe(true);
      expect("state" in prepared ? prepared.state.activeDatasetId : undefined).toBe("dataset-2");
    });
  });

  describe("given the active dataset id names no dataset", () => {
    it("refuses the run rather than executing a different dataset", async () => {
      findBySlugAndType.mockResolvedValue({
        id: "experiment_1",
        slug: "dangling-active-dataset",
        workbenchState: twoDatasetState("dataset-deleted"),
      });

      const prepared = await prepareSavedStateExecution({
        projectId: "project_1",
        slug: "dangling-active-dataset",
      });

      expect(prepared).toEqual({ error: "No dataset configured", status: 400 });
      expect(loadExecutionData).not.toHaveBeenCalled();
    });
  });
});
