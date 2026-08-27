import { describe, expect, it } from "vitest";
import { datasetWithRecordsSchema } from "@langwatch/dataset-contract";
import {
  nodeDatasetSchema,
  studioClientEventSchema,
  type StudioClientEvent,
} from "@langwatch/workflow-contract";
import { z } from "zod";
import { StudioDatasetMaterializerService } from "../src/services/studio-dataset-materializer.service";
import { TestDatasetService } from "./dataset.service.fake";

const PROJECT_ID = "project-123";

const entryDataSchema = z.looseObject({
  dataset: nodeDatasetSchema.optional(),
});

const makeEntryNode = (dataset: unknown) => ({
  id: "entry",
  type: "entry",
  position: { x: 0, y: 0 },
  data: {
    name: "Entry",
    dataset,
    outputs: [{ identifier: "question", type: "str" }],
  },
});

const makeEvent = (
  type: StudioClientEvent["type"],
  entryDataset: unknown,
  extraPayload: Record<string, unknown> = {},
): StudioClientEvent =>
  studioClientEventSchema.parse({
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
        version: "1.0",
        template_adapter: "default",
        default_llm: { model: "openai/gpt-4o" },
        nodes: [makeEntryNode(entryDataset)],
        edges: [],
        state: { execution: { status: "idle" } },
      },
      ...extraPayload,
    },
  });

const entryData = (event: StudioClientEvent) => {
  if (!("workflow" in event.payload)) {
    throw new Error("Expected a workflow payload.");
  }

  const entry = event.payload.workflow.nodes.find((node) => node.id === "entry");
  if (!entry) {
    throw new Error("Expected an entry node.");
  }

  return entryDataSchema.parse(entry.data);
};

const savedDataset = () =>
  datasetWithRecordsSchema.parse({
    dataset: {
      id: "ds_xyz",
      projectId: PROJECT_ID,
      name: "Saved",
      slug: "saved",
      columnTypes: [{ name: "question", type: "string" }],
      createdAt: new Date(0),
      updatedAt: new Date(0),
      archivedAt: null,
      mapping: null,
      useS3: false,
      s3RecordCount: null,
      contentLayout: "postgres",
      status: "ready",
      statusError: null,
      stagingKey: null,
      uploadFilename: null,
      rowCount: 2,
      sizeBytes: null,
      chunkCount: null,
      chunkOffsets: null,
    },
    records: [
      {
        id: "r1",
        datasetId: "ds_xyz",
        projectId: PROJECT_ID,
        entry: { question: "q1" },
        createdAt: new Date(0),
        updatedAt: new Date(0),
      },
      {
        id: "r2",
        datasetId: "ds_xyz",
        projectId: PROJECT_ID,
        entry: { question: "q2" },
        createdAt: new Date(0),
        updatedAt: new Date(0),
      },
    ],
    truncated: false,
  });

describe("StudioDatasetMaterializerService", () => {
  it("inlines saved datasets for evaluation runs", async () => {
    const datasets = new TestDatasetService(savedDataset());
    const event = makeEvent(
      "execute_evaluation",
      { id: "ds_xyz", name: "Saved" },
      {
        run_id: "run_1",
        workflow_version_id: "v1",
        evaluate_on: "full",
      },
    );

    const enriched = await StudioDatasetMaterializerService.create(datasets).materialize({
      event,
      projectId: PROJECT_ID,
    });

    expect(datasets.datasetReads).toEqual([
      {
        slugOrId: "ds_xyz",
        projectId: PROJECT_ID,
        entrySelection: "all",
        limitMb: null,
      },
    ]);
    expect(entryData(enriched).dataset?.inline?.records).toEqual({
      question: ["q1", "q2"],
    });
  });

  it("preserves inline datasets without fetching", async () => {
    const datasets = new TestDatasetService();
    const event = makeEvent(
      "execute_evaluation",
      {
        inline: {
          records: { question: ["a", "b"] },
          columnTypes: [{ name: "question", type: "string" }],
        },
      },
      {
        run_id: "run_2",
        workflow_version_id: "v1",
        evaluate_on: "full",
      },
    );

    const enriched = await StudioDatasetMaterializerService.create(datasets).materialize({
      event,
      projectId: PROJECT_ID,
    });

    expect(datasets.datasetReads).toEqual([]);
    expect(entryData(enriched).dataset?.inline?.records.question).toEqual(["a", "b"]);
  });

  it("strips the dataset from component execution", async () => {
    const datasets = new TestDatasetService();
    const event = makeEvent(
      "execute_component",
      { id: "ds_xyz", name: "Saved" },
      { node_id: "some_node", inputs: { foo: "bar" } },
    );

    const enriched = await StudioDatasetMaterializerService.create(datasets).materialize({
      event,
      projectId: PROJECT_ID,
    });

    expect(datasets.datasetReads).toEqual([]);
    expect(entryData(enriched).dataset).toBeUndefined();
  });
});
