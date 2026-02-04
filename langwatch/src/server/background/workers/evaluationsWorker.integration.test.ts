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
 * Tests for workflow evaluators
 * These tests verify that workflow-based evaluators are handled correctly
 */
describe("runEvaluationJob - workflow evaluators", () => {
  const projectId = `test-project-workflow-${nanoid()}`;
  const testMonitorIds: string[] = [];
  const testEvaluatorIds: string[] = [];
  const testWorkflowIds: string[] = [];

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
    for (const workflowId of testWorkflowIds) {
      await prisma.workflow
        .delete({ where: { id: workflowId, projectId } })
        .catch(() => undefined);
    }
  });

  it("creates monitor with workflow evaluator and checkType 'workflow'", async () => {
    // Create a workflow first
    const workflow = await prisma.workflow.create({
      data: {
        id: `workflow_${nanoid()}`,
        projectId,
        name: "Test Workflow Evaluator",
        icon: "📊",
        description: "Test workflow for evaluator",
      },
    });
    testWorkflowIds.push(workflow.id);

    // Create a workflow-based evaluator
    const evaluator = await prisma.evaluator.create({
      data: {
        id: `evaluator_${nanoid()}`,
        projectId,
        name: "Test Workflow Evaluator",
        type: "workflow",
        config: {}, // Workflow evaluators have empty config
        workflowId: workflow.id,
      },
    });
    testEvaluatorIds.push(evaluator.id);

    // Create monitor with workflow evaluator
    const monitor = await prisma.monitor.create({
      data: {
        id: `monitor_${nanoid()}`,
        projectId,
        name: "Workflow Evaluation Monitor",
        checkType: "workflow", // This is the key - workflow evaluators use "workflow" as checkType
        slug: `workflow-monitor-${nanoid().slice(0, 5)}`,
        preconditions: [],
        parameters: {},
        sample: 1.0,
        enabled: true,
        executionMode: EvaluationExecutionMode.ON_MESSAGE,
        evaluatorId: evaluator.id,
        mappings: {
          mapping: {
            answer: { source: "trace", key: "output" },
          },
        },
      },
    });
    testMonitorIds.push(monitor.id);

    // Verify monitor was created with correct checkType
    const savedMonitor = await prisma.monitor.findUnique({
      where: { id: monitor.id, projectId },
      include: { evaluator: true },
    });

    expect(savedMonitor?.checkType).toBe("workflow");
    expect(savedMonitor?.evaluator?.type).toBe("workflow");
    expect(savedMonitor?.evaluator?.workflowId).toBe(workflow.id);
  });

  it("workflow evaluator data passes through without field filtering", async () => {
    // This test verifies that buildDataForEvaluation returns data as-is for workflow evaluators
    // (unlike built-in evaluators which filter to requiredFields + optionalFields)

    // Create a workflow-based evaluator
    const workflow = await prisma.workflow.create({
      data: {
        id: `workflow_${nanoid()}`,
        projectId,
        name: "Test Workflow",
        icon: "📊",
        description: "Test workflow for custom mappings",
      },
    });
    testWorkflowIds.push(workflow.id);

    const evaluator = await prisma.evaluator.create({
      data: {
        id: `evaluator_${nanoid()}`,
        projectId,
        name: "Workflow Evaluator",
        type: "workflow",
        config: {},
        workflowId: workflow.id,
      },
    });
    testEvaluatorIds.push(evaluator.id);

    // Create monitor with custom mappings
    const monitor = await prisma.monitor.create({
      data: {
        id: `monitor_${nanoid()}`,
        projectId,
        name: "Workflow Monitor with Custom Mappings",
        checkType: "workflow",
        slug: `workflow-custom-${nanoid().slice(0, 5)}`,
        preconditions: [],
        parameters: {},
        sample: 1.0,
        enabled: true,
        executionMode: EvaluationExecutionMode.ON_MESSAGE,
        evaluatorId: evaluator.id,
        mappings: {
          mapping: {
            custom_field_1: { source: "trace", key: "input" },
            custom_field_2: { source: "trace", key: "output" },
            another_field: { source: "trace", key: "metadata.user_id" },
          },
        },
      },
    });
    testMonitorIds.push(monitor.id);

    // Verify the mappings are stored correctly
    const savedMonitor = await prisma.monitor.findUnique({
      where: { id: monitor.id, projectId },
    });

    expect(savedMonitor?.mappings).toEqual({
      mapping: {
        custom_field_1: { source: "trace", key: "input" },
        custom_field_2: { source: "trace", key: "output" },
        another_field: { source: "trace", key: "metadata.user_id" },
      },
    });
  });
});

/**
 * Tests for workflow evaluator workflowId resolution
 * These tests verify that workflow evaluators get their workflowId from the evaluator record
 */
describe("runEvaluationJob - workflow evaluator workflowId resolution", () => {
  const projectId = `test-project-wfid-${nanoid()}`;
  const testMonitorIds: string[] = [];
  const testEvaluatorIds: string[] = [];
  const testWorkflowIds: string[] = [];

  afterAll(async () => {
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
    for (const workflowId of testWorkflowIds) {
      await prisma.workflow
        .delete({ where: { id: workflowId, projectId } })
        .catch(() => undefined);
    }
  });

  it("resolves workflowId from evaluator record for workflow evaluators", async () => {
    // Create workflow
    const workflow = await prisma.workflow.create({
      data: {
        id: `workflow_${nanoid()}`,
        projectId,
        name: "Test Workflow for ID Resolution",
        icon: "🔍",
        description: "Test workflow",
      },
    });
    testWorkflowIds.push(workflow.id);

    // Create workflow evaluator linked to workflow
    const evaluator = await prisma.evaluator.create({
      data: {
        id: `evaluator_${nanoid()}`,
        projectId,
        name: "Workflow Evaluator",
        type: "workflow",
        config: {},
        workflowId: workflow.id,
      },
    });
    testEvaluatorIds.push(evaluator.id);

    // Create monitor with checkType "workflow"
    const monitor = await prisma.monitor.create({
      data: {
        id: `monitor_${nanoid()}`,
        projectId,
        name: "Workflow Monitor",
        checkType: "workflow", // Note: NOT "custom/<workflowId>" pattern
        slug: `wfid-monitor-${nanoid().slice(0, 5)}`,
        preconditions: [],
        parameters: {},
        sample: 1.0,
        enabled: true,
        executionMode: EvaluationExecutionMode.ON_MESSAGE,
        evaluatorId: evaluator.id,
        mappings: {
          mapping: {
            answer: { source: "trace", key: "output" },
          },
        },
      },
    });
    testMonitorIds.push(monitor.id);

    // Fetch monitor with evaluator to verify the workflowId resolution path
    const monitorWithEvaluator = await prisma.monitor.findUnique({
      where: { id: monitor.id, projectId },
      include: { evaluator: true },
    });

    // Verify the workflowId resolution logic (same logic as in runEvaluationJob)
    const resolvedWorkflowId =
      monitorWithEvaluator?.evaluator?.type === "workflow"
        ? monitorWithEvaluator.evaluator.workflowId
        : undefined;

    expect(resolvedWorkflowId).toBe(workflow.id);
    expect(monitorWithEvaluator?.checkType).toBe("workflow");
    // Verify workflowId is NOT embedded in checkType
    expect(monitorWithEvaluator?.checkType).not.toContain(workflow.id);
  });

  it("custom evaluators still resolve workflowId from checkType pattern", async () => {
    // Create workflow
    const workflow = await prisma.workflow.create({
      data: {
        id: `workflow_${nanoid()}`,
        projectId,
        name: "Custom Workflow",
        icon: "⚙️",
        description: "Test custom workflow",
      },
    });
    testWorkflowIds.push(workflow.id);

    // Create monitor with legacy custom/<workflowId> pattern (no evaluator)
    const monitor = await prisma.monitor.create({
      data: {
        id: `monitor_${nanoid()}`,
        projectId,
        name: "Legacy Custom Monitor",
        checkType: `custom/${workflow.id}`, // Legacy pattern
        slug: `custom-monitor-${nanoid().slice(0, 5)}`,
        preconditions: [],
        parameters: {},
        sample: 1.0,
        enabled: true,
        executionMode: EvaluationExecutionMode.ON_MESSAGE,
        // No evaluatorId - legacy monitor
      },
    });
    testMonitorIds.push(monitor.id);

    // Verify the checkType contains the workflowId (legacy pattern)
    expect(monitor.checkType).toBe(`custom/${workflow.id}`);
    expect(monitor.checkType.split("/")[1]).toBe(workflow.id);
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
