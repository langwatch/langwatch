import type { Worker } from "bullmq";
import { nanoid } from "nanoid";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { TRACE_CHECKS_INDEX, esClient } from "../elasticsearch";
import type { TraceCheck } from "../tracer/types";
import { scheduleTraceCheck, updateCheckStatusInES } from "./queue";
import * as traceChecksWorker from "./worker";

const mocks = vi.hoisted(() => {
  return {
    traceChecksProcess: vi.fn(),
  };
});

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

describe("Check Queue Integration Tests", () => {
  let worker: Worker | undefined;

  beforeEach(() => {
    mocks.traceChecksProcess.mockReset();
  });

  beforeAll(async () => {
    worker = traceChecksWorker.start(mocks.traceChecksProcess);
    await worker.waitUntilReady();
  });

  afterAll(async () => {
    vi.restoreAllMocks();

    console.log("Closing worker");
    await worker?.close();
  });

  beforeAll(async () => {
    // Delete test documents to ensure each test starts fresh
    await esClient.deleteByQuery({
      index: TRACE_CHECKS_INDEX,
      body: {
        query: {
          match: { trace_id: "test-trace-id" },
        },
      },
    });

    await esClient.deleteByQuery({
      index: TRACE_CHECKS_INDEX,
      body: {
        query: {
          match: { trace_id: "test-trace-id-success" },
        },
      },
    });

    await esClient.deleteByQuery({
      index: TRACE_CHECKS_INDEX,
      body: {
        query: {
          match: { trace_id: "test-trace-id-failure" },
        },
      },
    });
  });

  it('should schedule a trace check and update status to "scheduled" in ES', async () => {
    const check_type = "test_check";
    const trace_id = `test-trace-id-${nanoid()}`;
    const project_id = "test-project-id";

    await scheduleTraceCheck({ check_type, trace_id, project_id });

    // Wait for a bit to allow the job to be scheduled
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Query ES to verify the status is "scheduled"
    const response = await esClient.search<TraceCheck>({
      index: TRACE_CHECKS_INDEX,
      query: {
        term: { trace_id },
      },
    });

    expect(response.hits.hits).toHaveLength(1);
    expect(response.hits.hits[0]?._source?.status).toBe("scheduled");
  });

  it('should process a trace check successfully and update status to "succeeded" in ES', async () => {
    mocks.traceChecksProcess.mockResolvedValue({
      result: "succeeded test works",
    });

    const check_type = "test_check";
    const trace_id = `test-trace-id-success-${nanoid()}`;
    const project_id = "test-project-id";

    await scheduleTraceCheck({ check_type, trace_id, project_id, delay: 0 });

    // Wait for the job to be completed
    await new Promise((resolve) => worker?.on("completed", resolve));

    // Query ES to verify the status is "succeeded"
    const response = await esClient.search<TraceCheck>({
      index: TRACE_CHECKS_INDEX,
      query: {
        term: { trace_id },
      },
    });

    expect(response.hits.hits).toHaveLength(1);
    expect(response.hits.hits[0]?._source?.status).toBe("succeeded");
    expect(mocks.traceChecksProcess).toHaveBeenCalled();
  });

  it('should fail to process a trace check and update status to "failed" in ES', async () => {
    mocks.traceChecksProcess.mockRejectedValue("something wrong is not right");

    const check_type = "test_check";
    const trace_id = `test-trace-id-failure-${nanoid()}`;
    const project_id = "test-project-id";

    await scheduleTraceCheck({ check_type, trace_id, project_id, delay: 0 });

    // Wait for the worker to attempt to process the job
    await new Promise((resolve) => worker?.on("failed", resolve));

    // Query ES to verify the status is "failed"
    const response = await esClient.search<TraceCheck>({
      index: TRACE_CHECKS_INDEX,
      query: {
        term: { trace_id },
      },
    });

    expect(response.hits.hits).toHaveLength(1);
    expect(response.hits.hits[0]?._source?.status).toBe("failed");
    expect(mocks.traceChecksProcess).toHaveBeenCalled();
  });
});

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
