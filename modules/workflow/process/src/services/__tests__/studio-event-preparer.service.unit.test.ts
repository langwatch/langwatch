import type { AgentApi } from "@langwatch/agent-contract";
import { datasetWithRecordsSchema } from "@langwatch/dataset-contract";
import { studioClientEventSchema } from "@langwatch/workflow-contract";
import { describe, expect, it } from "vitest";

import { StudioEventPreparerService } from "../studio-event-preparer.service.ts";
import { TestDatasetService } from "./dataset.service.fake.ts";

const PROJECT_ID = "project-123";

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
      rowCount: 1,
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
    ],
    truncated: false,
  });

const evaluationEvent = () =>
  studioClientEventSchema.parse({
    type: "execute_evaluation",
    payload: {
      trace_id: "trace-1",
      run_id: "run_1",
      workflow_version_id: "v1",
      evaluate_on: "full",
      workflow: {
        workflow_id: "wf-1",
        spec_version: "1.5",
        name: "Test",
        icon: "x",
        description: "x",
        version: "1.0",
        nodes: [
          {
            id: "entry",
            type: "entry",
            position: { x: 0, y: 0 },
            data: {
              name: "Entry",
              dataset: { id: "ds_xyz", name: "Saved" },
              outputs: [{ identifier: "question", type: "str" }],
            },
          },
        ],
        edges: [],
        state: { execution: { status: "idle" } },
      },
    },
  });

describe("StudioEventPreparerService", () => {
  /** @scenario "Workflow prepares a Studio event through typed runtime ports" */
  it("enriches the event with project credentials before materializing its datasets", async () => {
    const order: string[] = [];
    const datasets = new TestDatasetService(savedDataset());
    const readDataset = datasets.getDatasetWithRecords.bind(datasets);
    datasets.getDatasetWithRecords = (input) => {
      order.push("dataset read");
      return readDataset(input);
    };
    const preparer = StudioEventPreparerService.create({
      datasets: datasets.api,
      agents: {} as Pick<AgentApi, "getById">,
      projectEnvironment: {
        get: async () => {
          order.push("project environment");
          return { secrets: { OPENAI_API_KEY: "sk-abc123" } };
        },
      },
      llmParameters: { resolve: async () => [] },
      runKeys: { mintRunKey: async () => "ownerless-run-key" },
      dispatchKeyFloorMs: 960_000,
    });

    const prepared = await preparer.prepare({ event: evaluationEvent(), projectId: PROJECT_ID });
    if (!("workflow" in prepared.payload)) throw new Error("expected workflow payload");
    const entry = prepared.payload.workflow.nodes.find((node) => node.id === "entry");

    expect(order).toEqual(["project environment", "dataset read"]);
    expect(prepared.payload.workflow).toMatchObject({
      api_key: "ownerless-run-key",
      project_id: PROJECT_ID,
      secrets: { OPENAI_API_KEY: "sk-abc123" },
    });
    expect(entry?.data).toMatchObject({
      dataset: { inline: { records: { question: ["q1"] } } },
    });
  });
});
