import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { scoreSatisfactionFromInput } from "./satisfaction";
import { TRACE_INDEX, esClient, traceIndexId } from "../../../elasticsearch";
import type { Trace } from "../../../tracer/types";
import { getTestProject } from "~/utils/testUtils";

describe("Satisfaction Scoring Integration Test", () => {
  let project;
  const testTraceId = "test-trace-satisfaction";
  const testTraceData: Trace = {
    trace_id: testTraceId,
    project_id: "",
    input: {
      value: "I am very happy with the service!",
    },
    timestamps: {
      started_at: Date.now(),
      inserted_at: Date.now(),
      updated_at: Date.now(),
    },
    metrics: {},
    metadata: {},
  };

  beforeAll(async () => {
    project = await getTestProject("satisfaction-scoring-integration-test");
    testTraceData.project_id = project.id;

    // Create a trace entry in Elasticsearch for the test
    await esClient.index({
      index: TRACE_INDEX.alias,
      id: traceIndexId({
        traceId: testTraceId,
        projectId: testTraceData.project_id,
      }),
      document: testTraceData,
      refresh: true,
    });
  });

  afterAll(async () => {
    // Clean up the test data from Elasticsearch
    await esClient.delete({
      index: TRACE_INDEX.alias,
      id: traceIndexId({
        traceId: testTraceId,
        projectId: testTraceData.project_id,
      }),
      refresh: true,
    });
  });

  it("scores satisfaction from input and updates Elasticsearch", async () => {
    // Call the scoreSatisfactionFromInput function
    // Ensure embeddings are available before scoring satisfaction
    await scoreSatisfactionFromInput({
      traceId: testTraceId,
      projectId: testTraceData.project_id,
      input: testTraceData.input,
    });

    // Fetch the updated trace from Elasticsearch and verify the satisfaction score was updated
    const result = await esClient.get<Trace>({
      index: TRACE_INDEX.alias,
      id: traceIndexId({
        traceId: testTraceId,
        projectId: testTraceData.project_id,
      }),
    });

    const updatedTrace = result._source;
    expect(updatedTrace).not.toBeNull();
    expect(updatedTrace?.input).toHaveProperty("satisfaction_score");
    expect(updatedTrace?.input?.satisfaction_score).toBeGreaterThan(0);
  });
});
