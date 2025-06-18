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
import { esClient, TRACE_INDEX } from "../../elasticsearch";
import type { ElasticSearchTrace } from "../../tracer/types";
import {
  scheduleEvaluation,
  updateEvaluationStatusInES,
} from "../queues/evaluationsQueue";
import * as traceChecksWorker from "../worker";
import type { EvaluationJob } from "~/server/background/types";
import type {
  EvaluatorTypes,
  SingleEvaluationResult,
} from "~/server/evaluations/evaluators.generated";

const mocks = vi.hoisted(() => {
  return {
    runEvaluation: vi.fn().mockResolvedValue({
      raw_result: { result: "test" },
      score: 1,
      status: "processed",
    } as SingleEvaluationResult),
  };
});

const getTraceCheck = async (
  traceId: string,
  checkId: string,
  projectId: string
) => {
  const client = await esClient({ test: true });
  return await client.search<ElasticSearchTrace>({
    index: TRACE_INDEX.alias,
    body: {
      query: {
        bool: {
          filter: [
            { term: { trace_id: traceId } },
            { term: { project_id: projectId } },
            {
              nested: {
                path: "evaluations",
                query: {
                  term: {
                    "evaluations.evaluator_id": checkId,
                  },
                },
              },
            },
          ],
        },
      },
    },
    _source: ["trace_id", "project_id", "evaluations"],
  });
};

describe("Check Queue Integration Tests", () => {
  let worker: Worker<EvaluationJob, any, EvaluatorTypes> | undefined;
  const trace_id = `test-trace-id-${nanoid()}`;
  const trace_id_success = `test-trace-id-success-${nanoid()}`;
  const trace_id_failed = `test-trace-id-failure-${nanoid()}`;
  const trace_id_error = `test-trace-id-error-${nanoid()}`;
  const check: EvaluationJob["check"] = {
    evaluation_id: nanoid(),
    evaluator_id: "check_123",
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
    const client = await esClient({ test: true });
    await client.deleteByQuery({
      index: TRACE_INDEX.alias,
      body: {
        query: {
          // starts with test-trace
          prefix: { trace_id: "test-trace-id-" },
        },
      },
    });
  });

  it.skip('should schedule a trace check and update status to "scheduled" in ES, making sure all the aggregation fields are also persisted', async () => {
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
    const client = await esClient({ test: true });
    const response = await client.search<ElasticSearchTrace>({
      index: TRACE_INDEX.alias,
      query: {
        bool: {
          filter: [
            { term: { trace_id: trace.trace_id } },
            { term: { project_id: "test-project-id" } },
          ],
        },
      },
      _source: [
        "trace_id",
        "project_id",
        "evaluations",
        "user_id",
        "thread_id",
        "customer_id",
        "labels",
      ],
    });

    expect(response.hits.hits).toHaveLength(1);

    const traceDoc = response.hits.hits[0]?._source;
    const evaluation = traceDoc?.evaluations?.find(
      (e) => e.evaluator_id === check.evaluator_id
    );
    expect(evaluation?.status).toBe("scheduled");

    expect(evaluation).toMatchObject({
      evaluation_id: expect.any(String),
      evaluator_id: check.evaluator_id,
      name: check.name,
      type: check.type,
    });

    expect(traceDoc).toMatchObject({
      trace_id: trace.trace_id,
      project_id: "test-project-id",
      user_id: "test_user_123",
      thread_id: "test_thread_123",
      customer_id: "test_customer_123",
      labels: ["test_label_123"],
    });
  });

  it.skip('should process a trace check successfully and update status to "processed" in ES', async () => {
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
    const client = await esClient({ test: true });
    const response = await client.search<ElasticSearchTrace>({
      index: TRACE_INDEX.alias,
      query: {
        bool: {
          filter: [
            { term: { trace_id: trace.trace_id } },
            { term: { project_id: "test-project-id" } },
          ],
        },
      },
      _source: ["trace_id", "project_id", "evaluations"],
    });

    expect(response.hits.hits).toHaveLength(1);
    const traceDoc = response.hits.hits[0]?._source;
    const evaluation = traceDoc?.evaluations?.find(
      (e) => e.evaluator_id === check.evaluator_id
    );
    expect(evaluation?.status).toBe("processed");
    expect(evaluation?.score).toBe(1);
    expect(mocks.runEvaluation).toHaveBeenCalled();
  });

  it.skip('should process a trace check that failed and update status to "processed" in ES', async () => {
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
    const client = await esClient({ test: true });
    const response = await client.search<ElasticSearchTrace>({
      index: TRACE_INDEX.alias,
      query: {
        bool: {
          filter: [
            { term: { trace_id: trace.trace_id } },
            { term: { project_id: "test-project-id" } },
          ],
        },
      },
      _source: ["trace_id", "project_id", "evaluations"],
    });

    expect(response.hits.hits).toHaveLength(1);
    const traceDoc = response.hits.hits[0]?._source;
    const evaluation = traceDoc?.evaluations?.find(
      (e) => e.evaluator_id === check.evaluator_id
    );
    expect(evaluation?.status).toBe("processed");
    expect(evaluation?.score).toBe(1);
    expect(evaluation?.passed).toBe(false);
    expect(mocks.runEvaluation).toHaveBeenCalled();
  });

  it.skip('should errors out when a trace check throws an exception and update status to "error" in ES', async () => {
    mocks.runEvaluation.mockRejectedValue("something wrong is not right");

    const trace = {
      trace_id: trace_id_error,
      project_id: "test-project-id",
    };

    await scheduleEvaluation({ check, trace });

    // Wait for the worker to attempt to process the job
    await new Promise((resolve) => worker?.on("failed", resolve));

    // Query ES to verify the status is "processed"
    const client = await esClient({ test: true });
    const response = await client.search<ElasticSearchTrace>({
      index: TRACE_INDEX.alias,
      query: {
        bool: {
          filter: [
            { term: { trace_id: trace.trace_id } },
            { term: { project_id: "test-project-id" } },
          ],
        },
      },
      _source: ["trace_id", "project_id", "evaluations"],
    });

    expect(response.hits.hits).toHaveLength(1);
    const traceDoc = response.hits.hits[0]?._source;
    const evaluation = traceDoc?.evaluations?.find(
      (e) => e.evaluator_id === check.evaluator_id
    );
    expect(evaluation?.status).toBe("error");
    expect(mocks.runEvaluation).toHaveBeenCalled();
  });

  it.skip("should re-process a trace check that is already successfull again if requested", async () => {
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
    const client = await esClient({ test: true });
    let response = await client.search<ElasticSearchTrace>({
      index: TRACE_INDEX.alias,
      query: {
        bool: {
          filter: [
            { term: { trace_id: trace.trace_id } },
            { term: { project_id: "test-project-id" } },
          ],
        },
      },
      _source: ["trace_id", "project_id", "evaluations"],
    });

    let traceDoc = response.hits.hits[0]?._source;
    let evaluation = traceDoc?.evaluations?.find(
      (e) => e.evaluator_id === check.evaluator_id
    );
    expect(evaluation?.status).toBe("processed");
    expect(evaluation?.score).toBe(1);
    expect(mocks.runEvaluation).toHaveBeenCalled();

    // Process the job again
    await scheduleEvaluation({ check, trace, delay: 0 });

    // Query ES to verify the status is "scheduled"
    response = await client.search<ElasticSearchTrace>({
      index: TRACE_INDEX.alias,
      query: {
        bool: {
          filter: [
            { term: { trace_id: trace.trace_id } },
            { term: { project_id: "test-project-id" } },
          ],
        },
      },
      _source: ["trace_id", "project_id", "evaluations"],
    });

    traceDoc = response.hits.hits[0]?._source;
    evaluation = traceDoc?.evaluations?.find(
      (e) => e.evaluator_id === check.evaluator_id
    );
    expect(evaluation?.status).toBe("scheduled");

    // Wait for the job to be completed
    await new Promise<void>(
      (resolve) =>
        worker?.on("completed", (args) => {
          if (args.data.trace.trace_id === trace_id_success) resolve();
        })
    );

    // Query ES to verify the status is "processed"
    response = await client.search<ElasticSearchTrace>({
      index: TRACE_INDEX.alias,
      query: {
        bool: {
          filter: [
            { term: { trace_id: trace.trace_id } },
            { term: { project_id: "test-project-id" } },
          ],
        },
      },
      _source: ["trace_id", "project_id", "evaluations"],
    });

    traceDoc = response.hits.hits[0]?._source;
    evaluation = traceDoc?.evaluations?.find(
      (e) => e.evaluator_id === check.evaluator_id
    );
    expect(evaluation?.status).toBe("processed");
    expect(evaluation?.score).toBe(1);
    expect(mocks.runEvaluation).toHaveBeenCalled();
  });
});

describe("updateCheckStatusInES", () => {
  const traceId = `test-trace-id-${nanoid()}`;
  const projectId = "test-project-id";
  const check: EvaluationJob["check"] = {
    evaluation_id: nanoid(),
    evaluator_id: "check_123",
    type: "langevals/basic",
    name: "My Custom Check",
  };

  afterAll(async () => {
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Delete test documents to not pollute the db
    const client = await esClient({ test: true });
    await client.deleteByQuery({
      index: TRACE_INDEX.alias,
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

    const response = await getTraceCheck(
      traceId,
      check.evaluator_id,
      projectId
    );
    expect((response.hits.total as any).value).toBeGreaterThan(0);
    const traceDoc = response.hits.hits[0]?._source;
    const evaluation = traceDoc?.evaluations?.find(
      (e) => e.evaluator_id === check.evaluator_id
    );
    expect(evaluation).toMatchObject({
      evaluation_id: expect.any(String),
      evaluator_id: check.evaluator_id,
      name: check.name,
      type: check.type,
      status: "scheduled",
    });
    expect(traceDoc).toMatchObject({
      trace_id: traceId,
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

    const response = await getTraceCheck(
      traceId,
      check.evaluator_id,
      projectId
    );
    expect((response.hits.total as any).value).toBeGreaterThan(0);
    const traceDoc = response.hits.hits[0]?._source;
    const evaluation = traceDoc?.evaluations?.find(
      (e) => e.evaluator_id === check.evaluator_id
    );
    expect(evaluation).toMatchObject({
      evaluation_id: expect.any(String),
      evaluator_id: check.evaluator_id,
      name: check.name,
      type: check.type,
      status: "in_progress",
    });
    expect(traceDoc).toMatchObject({
      trace_id: traceId,
      project_id: projectId,
    });
  });
});
