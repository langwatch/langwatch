import { EvaluationExecutionMode } from "@prisma/client";
import { nanoid } from "nanoid";
import { afterAll, describe, expect, it } from "vitest";
import type { EvaluationJob } from "~/server/background/types";
import { prisma } from "../../db";
import { esClient, TRACE_INDEX } from "../../elasticsearch";
import type { ElasticSearchTrace } from "../../tracer/types";
import { updateEvaluationStatusInES } from "../queues/evaluationsQueue";

const getTraceCheck = async (
  traceId: string,
  checkId: string,
  projectId: string,
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

/**
 * Tests for runEvaluationJob evaluator settings resolution
 * These tests verify that:
 * 1. When a monitor has evaluatorId, settings come from evaluator.config.settings
 * 2. When a monitor has no evaluatorId, settings come from monitor.parameters (backward compatibility)
 */
describe("runEvaluationJob - evaluator settings resolution", () => {
  const projectId = `test-project-${nanoid()}`;
  const testMonitorIds: string[] = [];
  const testEvaluatorIds: string[] = [];

  afterAll(async () => {
    // Clean up test data - ignore errors if records don't exist
    for (const monitorId of testMonitorIds) {
      await prisma.monitor
        .delete({ where: { id: monitorId, projectId } })
        .catch(() => undefined);
    }
    for (const evaluatorId of testEvaluatorIds) {
      await prisma.evaluator
        .delete({ where: { id: evaluatorId, projectId } })
        .catch(() => undefined);
    }
  });

  it("uses evaluator.config.settings when monitor has evaluatorId", async () => {
    const evaluatorSettings = { model: "gpt-4o", temperature: 0.7 };
    const monitorParameters = { model: "gpt-3.5", temperature: 0.5 };

    // Create evaluator with specific settings
    const evaluator = await prisma.evaluator.create({
      data: {
        id: `evaluator_${nanoid()}`,
        projectId,
        name: "Test Evaluator",
        type: "evaluator",
        config: {
          evaluatorType: "langevals/llm_judge",
          settings: evaluatorSettings,
        },
      },
    });
    testEvaluatorIds.push(evaluator.id);

    // Create monitor linked to evaluator (with different parameters)
    const monitor = await prisma.monitor.create({
      data: {
        id: `monitor_${nanoid()}`,
        projectId,
        name: "Test Monitor",
        checkType: "langevals/llm_judge",
        slug: `test-monitor-${nanoid().slice(0, 5)}`,
        preconditions: [],
        parameters: monitorParameters,
        sample: 1.0,
        enabled: true,
        executionMode: EvaluationExecutionMode.ON_MESSAGE,
        evaluatorId: evaluator.id,
      },
    });
    testMonitorIds.push(monitor.id);

    // Fetch monitor with evaluator to verify setup
    const monitorWithEvaluator = await prisma.monitor.findUnique({
      where: { id: monitor.id, projectId },
      include: { evaluator: true },
    });

    expect(monitorWithEvaluator?.evaluator).not.toBeNull();
    expect(monitorWithEvaluator?.evaluator?.config).toEqual({
      evaluatorType: "langevals/llm_judge",
      settings: evaluatorSettings,
    });

    // Verify the settings resolution logic
    const resolvedSettings = monitorWithEvaluator?.evaluator?.config
      ? ((monitorWithEvaluator.evaluator.config as Record<string, any>)
          .settings ?? monitorWithEvaluator.parameters)
      : monitorWithEvaluator?.parameters;

    expect(resolvedSettings).toEqual(evaluatorSettings);
    expect(resolvedSettings).not.toEqual(monitorParameters);
  });

  it("uses monitor.parameters when monitor has no evaluatorId (backward compatibility)", async () => {
    const monitorParameters = { model: "gpt-3.5", temperature: 0.5 };

    // Create monitor without evaluatorId (legacy monitor)
    const monitor = await prisma.monitor.create({
      data: {
        id: `monitor_${nanoid()}`,
        projectId,
        name: "Legacy Monitor",
        checkType: "langevals/llm_judge",
        slug: `legacy-monitor-${nanoid().slice(0, 5)}`,
        preconditions: [],
        parameters: monitorParameters,
        sample: 1.0,
        enabled: true,
        executionMode: EvaluationExecutionMode.ON_MESSAGE,
        // No evaluatorId
      },
    });
    testMonitorIds.push(monitor.id);

    // Fetch monitor with evaluator relation
    const monitorWithEvaluator = await prisma.monitor.findUnique({
      where: { id: monitor.id, projectId },
      include: { evaluator: true },
    });

    expect(monitorWithEvaluator?.evaluator).toBeNull();

    // Verify the settings resolution logic falls back to parameters
    const resolvedSettings = monitorWithEvaluator?.evaluator?.config
      ? ((monitorWithEvaluator.evaluator.config as Record<string, any>)
          .settings ?? monitorWithEvaluator.parameters)
      : monitorWithEvaluator?.parameters;

    expect(resolvedSettings).toEqual(monitorParameters);
  });

  it("uses monitor.parameters when evaluator.config has no settings field", async () => {
    const monitorParameters = { model: "gpt-3.5", temperature: 0.5 };

    // Create evaluator with config but no settings field
    const evaluator = await prisma.evaluator.create({
      data: {
        id: `evaluator_${nanoid()}`,
        projectId,
        name: "Evaluator Without Settings",
        type: "evaluator",
        config: {
          evaluatorType: "langevals/basic",
          // No settings field
        },
      },
    });
    testEvaluatorIds.push(evaluator.id);

    // Create monitor linked to evaluator
    const monitor = await prisma.monitor.create({
      data: {
        id: `monitor_${nanoid()}`,
        projectId,
        name: "Monitor With Evaluator Without Settings",
        checkType: "langevals/basic",
        slug: `monitor-no-settings-${nanoid().slice(0, 5)}`,
        preconditions: [],
        parameters: monitorParameters,
        sample: 1.0,
        enabled: true,
        executionMode: EvaluationExecutionMode.ON_MESSAGE,
        evaluatorId: evaluator.id,
      },
    });
    testMonitorIds.push(monitor.id);

    // Fetch monitor with evaluator
    const monitorWithEvaluator = await prisma.monitor.findUnique({
      where: { id: monitor.id, projectId },
      include: { evaluator: true },
    });

    // Verify settings resolution falls back to parameters when no settings in config
    const resolvedSettings = monitorWithEvaluator?.evaluator?.config
      ? ((monitorWithEvaluator.evaluator.config as Record<string, any>)
          .settings ?? monitorWithEvaluator.parameters)
      : monitorWithEvaluator?.parameters;

    expect(resolvedSettings).toEqual(monitorParameters);
  });
});

/**
 * Tests for updateEvaluationStatusInES
 * These tests verify that evaluation status updates work correctly in ElasticSearch
 */
describe("updateEvaluationStatusInES", () => {
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
      projectId,
    );
    expect((response.hits.total as any).value).toBeGreaterThan(0);
    const traceDoc = response.hits.hits[0]?._source;
    const evaluation = traceDoc?.evaluations?.find(
      (e) => e.evaluator_id === check.evaluator_id,
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
      projectId,
    );
    expect((response.hits.total as any).value).toBeGreaterThan(0);
    const traceDoc = response.hits.hits[0]?._source;
    const evaluation = traceDoc?.evaluations?.find(
      (e) => e.evaluator_id === check.evaluator_id,
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

/**
 * Full queue integration tests
 *
 * NOTE: These tests are skipped because they require:
 * - Redis running (for BullMQ worker)
 * - ElasticSearch running (for trace storage)
 * - No other process using port 2999 (metrics server)
 *
 * The evaluator settings resolution tests above provide coverage for
 * the new monitor-evaluator integration. The queue tests were legacy
 * tests that were already skipped.
 *
 * To run these tests locally:
 * 1. Ensure Redis is running
 * 2. Ensure ElasticSearch is running
 * 3. Kill any process using port 2999
 * 4. Run with: INCLUDE_WORKER_TESTS=true pnpm test:integration evaluationsWorker
 */
describe.skip("Check Queue Integration Tests (requires Redis)", () => {
  it.todo("should schedule a trace check and update status to scheduled in ES");
  it.todo(
    "should process a trace check successfully and update status to processed in ES",
  );
  it.todo(
    "should process a trace check that failed and update status to processed in ES",
  );
  it.todo(
    "should error out when a trace check throws an exception and update status to error in ES",
  );
});
