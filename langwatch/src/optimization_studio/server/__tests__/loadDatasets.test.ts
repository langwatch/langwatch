import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StudioClientEvent } from "../../types/events";

vi.mock("../../../server/api/routers/datasetRecord.utils", () => ({
  getFullDataset: vi.fn(),
}));

vi.mock("../../utils/datasetUtils", async () => {
  const actual = await vi.importActual<typeof import("../../utils/datasetUtils")>(
    "../../utils/datasetUtils",
  );
  return actual;
});

import { getFullDataset } from "../../../server/api/routers/datasetRecord.utils";
import { loadDatasets } from "../loadDatasets";

const PROJECT_ID = "project-123";

const makeEntryNode = (dataset: any) => ({
  id: "entry",
  type: "entry",
  data: {
    name: "Entry",
    dataset,
    outputs: [{ identifier: "question", type: "str" }],
  },
});

const makeEvent = (
  type: StudioClientEvent["type"],
  entryDataset: any,
  extraPayload: Record<string, any> = {},
): StudioClientEvent =>
  ({
    type,
    payload: {
      trace_id: "trace-1",
      workflow: {
        workflow_id: "wf-1",
        api_key: "k",
        spec_version: "1.4",
        name: "Test",
        icon: "x",
        description: "x",
        version: "x",
        template_adapter: "default",
        default_llm: { model: "openai/gpt-4o" },
        nodes: [makeEntryNode(entryDataset)],
        edges: [],
        state: { execution: { status: "idle" as const } },
      },
      ...extraPayload,
    },
  }) as unknown as StudioClientEvent;

describe("loadDatasets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Regression pin for the 3.2.0 prod break (a customer saw
  // "entry node has no inline dataset (remote datasets not yet
  // supported on Go path)" on a saved-dataset Evaluate run). Pre-fix,
  // execute_evaluation forced entrySelection="all" then short-circuited
  // the database-dataset branch with `if (entrySelection == "all") return
  // node;`, so the Go engine received a dataset_id-only payload and
  // rejected it. Now loadDatasets always fetches + inlines on the
  // database path, regardless of evaluate_on/entry_selection mode.
  it("inlines saved (database) datasets on execute_evaluation when entry_selection is all", async () => {
    (getFullDataset as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "ds_xyz",
      name: "Saved",
      datasetRecords: [
        { id: "r1", entry: { question: "q1" }, createdAt: new Date(), updatedAt: new Date() },
        { id: "r2", entry: { question: "q2" }, createdAt: new Date(), updatedAt: new Date() },
      ],
      count: 2,
      truncated: false,
      columnTypes: [{ name: "question", type: "string" }],
    });

    const event = makeEvent(
      "execute_evaluation",
      { id: "ds_xyz", name: "Saved" },
      {
        run_id: "run_1",
        workflow_version_id: "v1",
        evaluate_on: "full",
      },
    );

    const enriched = await loadDatasets(event, PROJECT_ID);

    expect(getFullDataset).toHaveBeenCalledWith({
      datasetId: "ds_xyz",
      projectId: PROJECT_ID,
      entrySelection: "all",
    });

    if (!("workflow" in enriched.payload)) {
      throw new Error("expected workflow in payload");
    }
    const entry = enriched.payload.workflow.nodes.find(
      (n: any) => n.id === "entry",
    );
    expect(entry).toBeDefined();
    expect((entry as any).data.dataset.inline).toBeDefined();
    expect((entry as any).data.dataset.inline.records).toBeDefined();
    expect((entry as any).data.dataset.inline.records.question).toEqual([
      "q1",
      "q2",
    ]);
  });

  it("preserves inline datasets without fetching", async () => {
    const event = makeEvent(
      "execute_evaluation",
      {
        inline: {
          records: { question: ["a", "b"] },
        },
      },
      {
        run_id: "run_2",
        workflow_version_id: "v1",
        evaluate_on: "full",
      },
    );

    const enriched = await loadDatasets(event, PROJECT_ID);

    expect(getFullDataset).not.toHaveBeenCalled();
    if (!("workflow" in enriched.payload)) {
      throw new Error("expected workflow in payload");
    }
    const entry = enriched.payload.workflow.nodes.find(
      (n: any) => n.id === "entry",
    );
    expect((entry as any).data.dataset.inline.records.question).toEqual([
      "a",
      "b",
    ]);
  });

  it("strips dataset on execute_component to keep the engine focused on the named node", async () => {
    const event = makeEvent(
      "execute_component",
      { id: "ds_xyz", name: "Saved" },
      { node_id: "some_node", inputs: { foo: "bar" } },
    );

    const enriched = await loadDatasets(event, PROJECT_ID);

    expect(getFullDataset).not.toHaveBeenCalled();
    if (!("workflow" in enriched.payload)) {
      throw new Error("expected workflow in payload");
    }
    const entry = enriched.payload.workflow.nodes.find(
      (n: any) => n.id === "entry",
    );
    expect((entry as any).data.dataset).toBeUndefined();
  });
});
