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
import { TRACE_CHECKS_INDEX, esClient } from "../../elasticsearch";
import type { TraceCheck } from "../../tracer/types";
import {
  getTraceCheckId,
  scheduleTraceCheck,
  updateCheckStatusInES,
} from "../queues/traceChecksQueue";
import * as traceChecksWorker from "../worker";
import type { CheckTypes, TraceCheckResult } from "../../../trace_checks/types";
import type { TraceCheckJob } from "~/server/background/types";

const mocks = vi.hoisted(() => {
  return {
    traceChecksProcess: vi.fn<any, Promise<TraceCheckResult>>(),
  };
});

const getTraceCheck = async (traceId: string, checkId: string) => {
  return await esClient.search({
    index: TRACE_CHECKS_INDEX,
    body: {
      query: {
        match: {
          id: getTraceCheckId(traceId, checkId),
        },
      },
    },
  });
};

describe("Check Queue Integration Tests", () => {
  let worker: Worker<TraceCheckJob, any, CheckTypes> | undefined;
  const trace_id = `test-trace-id-${nanoid()}`;
  const trace_id_success = `test-trace-id-success-${nanoid()}`;
  const trace_id_failed = `test-trace-id-failure-${nanoid()}`;
  const trace_id_error = `test-trace-id-error-${nanoid()}`;
  const check: TraceCheckJob["check"] = {
    id: "check_123",
    type: "custom",
    name: "My Custom Check",
  };

  beforeEach(() => {
    mocks.traceChecksProcess.mockReset();
  });

  beforeAll(async () => {
    const workers = await traceChecksWorker.start(mocks.traceChecksProcess);
    worker = workers?.traceChecksWorker;
    await worker?.waitUntilReady();
  });

  afterAll(async () => {
    vi.restoreAllMocks();

    await worker?.close();

    // Delete test documents
    await esClient.deleteByQuery({
      index: TRACE_CHECKS_INDEX,
      body: {
        query: {
          match: { trace_id: trace_id },
        },
      },
    });

    await esClient.deleteByQuery({
      index: TRACE_CHECKS_INDEX,
      body: {
        query: {
          match: { trace_id: trace_id_success },
        },
      },
    });

    await esClient.deleteByQuery({
      index: TRACE_CHECKS_INDEX,
      body: {
        query: {
          match: { trace_id: trace_id_failed },
        },
      },
    });

    await esClient.deleteByQuery({
      index: TRACE_CHECKS_INDEX,
      body: {
        query: {
          match: { trace_id: trace_id_error },
        },
      },
    });
  });

  it('should schedule a trace check and update status to "scheduled" in ES, making sure all the aggregation fields are also persisted', async () => {
    mocks.traceChecksProcess.mockResolvedValue({
      raw_result: { result: "it works" },
      value: 1,
      status: "succeeded",
      costs: [],
    });

    const trace = {
      id: trace_id,
      project_id: "test-project-id",
      user_id: "test_user_123",
      thread_id: "test_thread_123",
      customer_id: "test_customer_123",
      labels: ["test_label_123"],
    };

    await scheduleTraceCheck({ check, trace });

    // Wait for a bit to allow the job to be scheduled
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Query ES to verify the status is "scheduled"
    const response = await esClient.search<TraceCheck>({
      index: TRACE_CHECKS_INDEX,
      query: {
        term: { trace_id: trace.id },
      },
    });

    expect(response.hits.hits).toHaveLength(1);

    const traceCheck = response.hits.hits[0]?._source;
    expect(traceCheck?.status).toBe("scheduled");

    expect(traceCheck).toMatchObject({
      check_id: check.id,
      check_name: check.name,
      check_type: check.type,
      trace_id: trace.id,
      project_id: "test-project-id",
      user_id: "test_user_123",
      thread_id: "test_thread_123",
      customer_id: "test_customer_123",
      labels: ["test_label_123"],
    });
  });

  it('should process a trace check successfully and update status to "succeeded" in ES', async () => {
    mocks.traceChecksProcess.mockResolvedValue({
      raw_result: { result: "succeeded test works" },
      value: 1,
      status: "succeeded",
      costs: [],
    });

    const trace = {
      id: trace_id_success,
      project_id: "test-project-id",
    };

    await scheduleTraceCheck({ check, trace });

    // Wait for the job to be completed
    await new Promise<void>(
      (resolve) =>
        worker?.on("completed", (args) => {
          if (args.data.trace.id === trace_id_success) resolve();
        })
    );

    // Query ES to verify the status is "succeeded"
    const response = await esClient.search<TraceCheck>({
      index: TRACE_CHECKS_INDEX,
      query: {
        term: { trace_id: trace.id },
      },
    });

    expect(response.hits.hits).toHaveLength(1);
    expect(response.hits.hits[0]?._source?.status).toBe("succeeded");
    expect(response.hits.hits[0]?._source?.value).toBe(1);
    expect(mocks.traceChecksProcess).toHaveBeenCalled();
  });

  it('should process a trace check that failed and update status to "failed" in ES', async () => {
    mocks.traceChecksProcess.mockResolvedValue({
      raw_result: { result: "succeeded test works" },
      value: 1,
      status: "failed",
      costs: [],
    });

    const trace = {
      id: trace_id_failed,
      project_id: "test-project-id",
    };

    await scheduleTraceCheck({ check, trace });

    // Wait for the job to be completed
    await new Promise<void>(
      (resolve) =>
        worker?.on("completed", (args) => {
          if (args.data.trace.id === trace_id_failed) resolve();
        })
    );

    // Query ES to verify the status is "failed"
    const response = await esClient.search<TraceCheck>({
      index: TRACE_CHECKS_INDEX,
      query: {
        term: { trace_id: trace.id },
      },
    });

    expect(response.hits.hits).toHaveLength(1);
    expect(response.hits.hits[0]?._source?.status).toBe("failed");
    expect(response.hits.hits[0]?._source?.value).toBe(1);
    expect(mocks.traceChecksProcess).toHaveBeenCalled();
  });

  it('should errors out when a trace check throws an exception and update status to "error" in ES', async () => {
    mocks.traceChecksProcess.mockRejectedValue("something wrong is not right");

    const trace = {
      id: trace_id_error,
      project_id: "test-project-id",
    };

    await scheduleTraceCheck({ check, trace });

    // Wait for the worker to attempt to process the job
    await new Promise((resolve) => worker?.on("failed", resolve));

    // Query ES to verify the status is "failed"
    const response = await esClient.search<TraceCheck>({
      index: TRACE_CHECKS_INDEX,
      query: {
        term: { trace_id: trace.id },
      },
    });

    expect(response.hits.hits).toHaveLength(1);
    expect(response.hits.hits[0]?._source?.status).toBe("error");
    expect(mocks.traceChecksProcess).toHaveBeenCalled();
  });

  it("should re-process a trace check that is already successfull again if requested", async () => {
    mocks.traceChecksProcess.mockResolvedValue({
      raw_result: { result: "succeeded test works" },
      value: 1,
      status: "succeeded",
      costs: [],
    });

    const trace = {
      id: trace_id_success,
      project_id: "test-project-id",
    };

    await scheduleTraceCheck({ check, trace });

    // Wait for the job to be completed
    await new Promise<void>(
      (resolve) =>
        worker?.on("completed", (args) => {
          if (args.data.trace.id === trace_id_success) resolve();
        })
    );

    // Query ES to verify the status is "succeeded"
    let response = await esClient.search<TraceCheck>({
      index: TRACE_CHECKS_INDEX,
      query: {
        term: { trace_id: trace.id },
      },
    });

    expect(response.hits.hits[0]?._source?.status).toBe("succeeded");
    expect(response.hits.hits[0]?._source?.value).toBe(1);
    expect(mocks.traceChecksProcess).toHaveBeenCalled();

    // Process the job again
    await scheduleTraceCheck({ check, trace });

    // Query ES to verify the status is "scheduled"
    response = await esClient.search<TraceCheck>({
      index: TRACE_CHECKS_INDEX,
      query: {
        term: { trace_id: trace.id },
      },
    });

    expect(response.hits.hits[0]?._source?.status).toBe("scheduled");

    // Wait for the job to be completed
    await new Promise<void>(
      (resolve) =>
        worker?.on("completed", (args) => {
          if (args.data.trace.id === trace_id_success) resolve();
        })
    );

    // Query ES to verify the status is "succeeded"
    response = await esClient.search<TraceCheck>({
      index: TRACE_CHECKS_INDEX,
      query: {
        term: { trace_id: trace.id },
      },
    });

    expect(response.hits.hits[0]?._source?.status).toBe("succeeded");
    expect(response.hits.hits[0]?._source?.value).toBe(1);
    expect(mocks.traceChecksProcess).toHaveBeenCalled();
  });
});

describe("updateCheckStatusInES", () => {
  const traceId = `test-trace-id-${nanoid()}`;
  const projectId = "test-project-id";
  const check: TraceCheckJob["check"] = {
    id: "check_123",
    type: "custom",
    name: "My Custom Check",
  };

  afterAll(async () => {
    // Delete test documents to not polute the db
    await esClient.deleteByQuery({
      index: TRACE_CHECKS_INDEX,
      body: {
        query: {
          match: { project_id: projectId },
        },
      },
    });
  });

  it("should insert a new trace check if none exists", async () => {
    await updateCheckStatusInES({
      check,
      trace: {
        id: traceId,
        project_id: projectId,
      },
      status: "scheduled",
    });

    const response = await getTraceCheck(traceId, check.id);
    expect((response.hits.total as any).value).toBe(1);
    const traceCheck = response.hits.hits[0]?._source;
    expect(traceCheck).toMatchObject({
      id: getTraceCheckId(traceId, check.id),
      check_id: check.id,
      check_name: check.name,
      check_type: check.type,
      trace_id: traceId,
      status: "scheduled",
      project_id: projectId,
    });
  });

  it("should update an existing trace check", async () => {
    // Insert the initial document
    await updateCheckStatusInES({
      check,
      trace: {
        id: traceId,
        project_id: projectId,
      },
      status: "scheduled",
    });

    // Update the document
    await updateCheckStatusInES({
      check,
      trace: {
        id: traceId,
        project_id: projectId,
      },
      status: "in_progress",
    });

    const response = await getTraceCheck(traceId, check.id);
    expect((response.hits.total as any).value).toBe(1);
    const traceCheck = response.hits.hits[0]?._source;
    expect(traceCheck).toMatchObject({
      id: getTraceCheckId(traceId, check.id),
      check_id: check.id,
      check_name: check.name,
      check_type: check.type,
      trace_id: traceId,
      project_id: projectId,
      status: "in_progress",
    });
  });
});
