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
import type { ElasticSearchEvaluation } from "../../tracer/types";
import {
  scheduleEvaluation,
  updateEvaluationStatusInES,
} from "../queues/evaluationsQueue";
import { traceCheckIndexId } from "~/server/elasticsearch";
import * as traceChecksWorker from "../worker";
import type { EvaluationJob } from "~/server/background/types";
import type {
  EvaluatorTypes,
  SingleEvaluationResult,
} from "../../../evaluations/evaluators.generated";

const mocks = vi.hoisted(() => {
  return {
    runEvaluation: vi.fn<any, Promise<SingleEvaluationResult>>(),
  };
});

const getTraceCheck = async (
  traceId: string,
  checkId: string,
  projectId: string
) => {
  return await esClient.search({
    index: TRACE_CHECKS_INDEX,
    body: {
      query: {
        match: {
          id: traceCheckIndexId({ traceId, checkId, projectId }),
        },
      },
    },
  });
};

describe("Check Queue Integration Tests", () => {
  let worker: Worker<EvaluationJob, any, EvaluatorTypes> | undefined;
  const trace_id = `test-trace-id-${nanoid()}`;
  const trace_id_success = `test-trace-id-success-${nanoid()}`;
  const trace_id_failed = `test-trace-id-failure-${nanoid()}`;
  const trace_id_error = `test-trace-id-error-${nanoid()}`;
  const check: EvaluationJob["check"] = {
    id: "check_123",
    type: "langevals/basic",
    name: "My Custom Check",
  };

  beforeEach(() => {
    mocks.runEvaluation.mockReset();
  });

  beforeAll(async () => {
    const workers = await traceChecksWorker.start(mocks.runEvaluation);
    worker = workers?.evaluationsWorker;
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
          // starts with test-trace
          prefix: { trace_id: "test-trace-id-" },
        },
      },
    });
  });

  it('should schedule a trace check and update status to "scheduled" in ES, making sure all the aggregation fields are also persisted', async () => {
    mocks.runEvaluation.mockResolvedValue({
      raw_result: { result: "it works" },
      score: 1,
      status: "processed",
    });

    const trace = {
      trace_id: trace_id,
      project_id: "test-project-id",
      user_id: "test_user_123",
      thread_id: "test_thread_123",
      customer_id: "test_customer_123",
      labels: ["test_label_123"],
    };

    await scheduleEvaluation({ check, trace, delay: 0 });

    // Wait for a bit to allow the job to be scheduled
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Query ES to verify the status is "scheduled"
    const response = await esClient.search<ElasticSearchEvaluation>({
      index: TRACE_CHECKS_INDEX,
      query: {
        term: { trace_id: trace.trace_id },
      },
    });

    expect(response.hits.hits).toHaveLength(1);

    const traceCheck = response.hits.hits[0]?._source;
    expect(traceCheck?.status).toBe("scheduled");

    expect(traceCheck).toMatchObject({
      evaluation_id: expect.any(String),
      evaluator_id: check.id,
      name: check.name,
      type: check.type,
      trace_id: trace.trace_id,
      project_id: "test-project-id",
      user_id: "test_user_123",
      thread_id: "test_thread_123",
      customer_id: "test_customer_123",
      labels: ["test_label_123"],
    });
  });

  it('should process a trace check successfully and update status to "processed" in ES', async () => {
    mocks.runEvaluation.mockResolvedValue({
      raw_result: { result: "succeeded test works" },
      score: 1,
      status: "processed",
    });

    const trace = {
      trace_id: trace_id_success,
      project_id: "test-project-id",
    };

    await scheduleEvaluation({ check, trace, delay: 0 });

    // Wait for the job to be completed
    await new Promise<void>(
      (resolve) =>
        worker?.on("completed", (args) => {
          if (args.data.trace.trace_id === trace_id_success) resolve();
        })
    );

    // Query ES to verify the status is "processed"
    const response = await esClient.search<ElasticSearchEvaluation>({
      index: TRACE_CHECKS_INDEX,
      query: {
        term: { trace_id: trace.trace_id },
      },
    });

    expect(response.hits.hits).toHaveLength(1);
    expect(response.hits.hits[0]?._source?.status).toBe("processed");
    expect(response.hits.hits[0]?._source?.score).toBe(1);
    expect(mocks.runEvaluation).toHaveBeenCalled();
  });

  it('should process a trace check that failed and update status to "processed" in ES', async () => {
    mocks.runEvaluation.mockResolvedValue({
      raw_result: { result: "succeeded test works" },
      score: 1,
      passed: false,
      status: "processed",
    });

    const trace = {
      trace_id: trace_id_failed,
      project_id: "test-project-id",
    };

    await scheduleEvaluation({ check, trace, delay: 0 });

    // Wait for the job to be completed
    await new Promise<void>(
      (resolve) =>
        worker?.on("completed", (args) => {
          if (args.data.trace.trace_id === trace_id_failed) resolve();
        })
    );

    // Query ES to verify the status is "processed"
    const response = await esClient.search<ElasticSearchEvaluation>({
      index: TRACE_CHECKS_INDEX,
      query: {
        term: { trace_id: trace.trace_id },
      },
    });

    expect(response.hits.hits).toHaveLength(1);
    expect(response.hits.hits[0]?._source?.status).toBe("processed");
    expect(response.hits.hits[0]?._source?.score).toBe(1);
    expect(response.hits.hits[0]?._source?.passed).toBe(false);
    expect(mocks.runEvaluation).toHaveBeenCalled();
  });

  it('should errors out when a trace check throws an exception and update status to "error" in ES', async () => {
    mocks.runEvaluation.mockRejectedValue("something wrong is not right");

    const trace = {
      trace_id: trace_id_error,
      project_id: "test-project-id",
    };

    await scheduleEvaluation({ check, trace });

    // Wait for the worker to attempt to process the job
    await new Promise((resolve) => worker?.on("failed", resolve));

    // Query ES to verify the status is "processed"
    const response = await esClient.search<ElasticSearchEvaluation>({
      index: TRACE_CHECKS_INDEX,
      query: {
        term: { trace_id: trace.trace_id },
      },
    });

    expect(response.hits.hits).toHaveLength(1);
    expect(response.hits.hits[0]?._source?.status).toBe("error");
    expect(mocks.runEvaluation).toHaveBeenCalled();
  });

  it("should re-process a trace check that is already successfull again if requested", async () => {
    mocks.runEvaluation.mockResolvedValue({
      raw_result: { result: "succeeded test works" },
      score: 1,
      status: "processed",
    });

    const trace = {
      trace_id: trace_id_success,
      project_id: "test-project-id",
    };

    await scheduleEvaluation({ check, trace, delay: 0 });

    // Wait for the job to be completed
    await new Promise<void>(
      (resolve) =>
        worker?.on("completed", (args) => {
          if (args.data.trace.trace_id === trace_id_success) resolve();
        })
    );

    // Query ES to verify the status is "processed"
    let response = await esClient.search<ElasticSearchEvaluation>({
      index: TRACE_CHECKS_INDEX,
      query: {
        term: { trace_id: trace.trace_id },
      },
    });

    expect(response.hits.hits[0]?._source?.status).toBe("processed");
    expect(response.hits.hits[0]?._source?.score).toBe(1);
    expect(mocks.runEvaluation).toHaveBeenCalled();

    // Process the job again
    await scheduleEvaluation({ check, trace, delay: 0 });

    // Query ES to verify the status is "scheduled"
    response = await esClient.search<ElasticSearchEvaluation>({
      index: TRACE_CHECKS_INDEX,
      query: {
        term: { trace_id: trace.trace_id },
      },
    });

    expect(response.hits.hits[0]?._source?.status).toBe("scheduled");

    // Wait for the job to be completed
    await new Promise<void>(
      (resolve) =>
        worker?.on("completed", (args) => {
          if (args.data.trace.trace_id === trace_id_success) resolve();
        })
    );

    // Query ES to verify the status is "processed"
    response = await esClient.search<ElasticSearchEvaluation>({
      index: TRACE_CHECKS_INDEX,
      query: {
        term: { trace_id: trace.trace_id },
      },
    });

    expect(response.hits.hits[0]?._source?.status).toBe("processed");
    expect(response.hits.hits[0]?._source?.score).toBe(1);
    expect(mocks.runEvaluation).toHaveBeenCalled();
  });
});

describe("updateCheckStatusInES", () => {
  const traceId = `test-trace-id-${nanoid()}`;
  const projectId = "test-project-id";
  const check: EvaluationJob["check"] = {
    id: "check_123",
    type: "langevals/basic",
    name: "My Custom Check",
  };

  afterAll(async () => {
    await new Promise((resolve) => setTimeout(resolve, 1000));

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
    await updateEvaluationStatusInES({
      check,
      trace: {
        trace_id: traceId,
        project_id: projectId,
      },
      status: "scheduled",
    });

    const response = await getTraceCheck(traceId, check.id, projectId);
    expect((response.hits.total as any).value).toBeGreaterThan(0);
    const traceCheck = response.hits.hits[0]?._source;
    expect(traceCheck).toMatchObject({
      evaluation_id: expect.any(String),
      evaluator_id: check.id,
      name: check.name,
      type: check.type,
      trace_id: traceId,
      status: "scheduled",
      project_id: projectId,
    });
  });

  it("should update an existing trace check", async () => {
    // Insert the initial document
    await updateEvaluationStatusInES({
      check,
      trace: {
        trace_id: traceId,
        project_id: projectId,
      },
      status: "scheduled",
    });

    // Update the document
    await updateEvaluationStatusInES({
      check,
      trace: {
        trace_id: traceId,
        project_id: projectId,
      },
      status: "in_progress",
    });

    const response = await getTraceCheck(traceId, check.id, projectId);
    expect((response.hits.total as any).value).toBeGreaterThan(0);
    const traceCheck = response.hits.hits[0]?._source;
    expect(traceCheck).toMatchObject({
      evaluation_id: expect.any(String),
      evaluator_id: check.id,
      name: check.name,
      type: check.type,
      trace_id: traceId,
      project_id: projectId,
      status: "in_progress",
    });
  });
});
