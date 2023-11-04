import { beforeEach, describe, expect, it } from "vitest";
import { TRACE_CHECKS_INDEX, esClient } from "../elasticsearch";
import { updateCheckStatusInES } from "./utils";

const getTraceCheck = async (traceId: string, checkType: string) => {
  return await esClient.search({
    index: TRACE_CHECKS_INDEX,
    body: {
      query: {
        match: {
          id: `check_${traceId}/${checkType}`,
        },
      },
    },
  });
};

describe("updateCheckStatusInES", () => {
  const traceId = "test-trace-id";
  const projectId = "test-project-id";
  const checkType = "pii_check";

  beforeEach(async () => {
    // Delete test documents to ensure each test starts fresh
    await esClient.deleteByQuery({
      index: TRACE_CHECKS_INDEX,
      body: {
        query: {
          match: { trace_id: traceId },
        },
      },
    });
  });

  it("should insert a new trace check if none exists", async () => {
    await updateCheckStatusInES({
      trace_id: traceId,
      project_id: projectId,
      check_type: checkType,
      status: "scheduled",
    });

    const response = await getTraceCheck(traceId, checkType);
    expect((response.hits.total as any).value).toBe(1);
    const traceCheck = response.hits.hits[0]?._source;
    expect(traceCheck).toMatchObject({
      trace_id: traceId,
      project_id: projectId,
      check_type: checkType,
      status: "scheduled",
    });
  });

  it("should update an existing trace check", async () => {
    // Insert the initial document
    await updateCheckStatusInES({
      trace_id: traceId,
      project_id: projectId,
      check_type: checkType,
      status: "scheduled",
    });

    // Update the document
    await updateCheckStatusInES({
      trace_id: traceId,
      project_id: projectId,
      check_type: checkType,
      status: "in_progress",
    });

    const response = await getTraceCheck(traceId, checkType);
    expect((response.hits.total as any).value).toBe(1);
    const traceCheck = response.hits.hits[0]?._source;
    expect(traceCheck).toMatchObject({
      trace_id: traceId,
      project_id: projectId,
      check_type: checkType,
      status: "in_progress",
    });
  });
});
