/**
 * @vitest-environment node
 *
 * Integration tests for cascade archive functionality.
 * Tests the cascading archive/delete behavior for workflows, evaluators, and agents.
 */
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { nanoid } from "nanoid";
import { getTestUser } from "../../../../utils/testUtils";
import { prisma } from "../../../db";
import { appRouter } from "../../root";
import { createInnerTRPCContext } from "../../trpc";

// Mock license enforcement to avoid limits during tests
vi.mock("../../../license-enforcement", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../license-enforcement")>();
  return {
    ...actual,
    enforceLicenseLimit: vi.fn(),
  };
});

describe("Cascade Archive", () => {
  const projectId = "test-project-id";
  let caller: ReturnType<typeof appRouter.createCaller>;
  const testNamespace = `cascade-${nanoid(8)}`;

  // Track resources for cleanup
  const createdWorkflowIds: string[] = [];
  const createdEvaluatorIds: string[] = [];
  const createdAgentIds: string[] = [];
  const createdMonitorIds: string[] = [];

  beforeAll(async () => {
    const user = await getTestUser();
    const ctx = createInnerTRPCContext({
      session: {
        user: { id: user.id },
        expires: "1",
      },
    });
    caller = appRouter.createCaller(ctx);
  });

  afterAll(async () => {
    // Cleanup in reverse order of creation
    for (const id of createdMonitorIds) {
      await prisma.monitor.delete({ where: { id, projectId } }).catch(() => {});
    }
    for (const id of createdEvaluatorIds) {
      await prisma.evaluator.delete({ where: { id, projectId } }).catch(() => {});
    }
    for (const id of createdAgentIds) {
      await prisma.agent.delete({ where: { id, projectId } }).catch(() => {});
    }
    for (const id of createdWorkflowIds) {
      // Clear currentVersionId first, then delete versions, then workflow
      await prisma.workflow.update({ where: { id, projectId }, data: { currentVersionId: null } }).catch(() => {});
      await prisma.workflowVersion.deleteMany({ where: { workflowId: id, projectId } }).catch(() => {});
      await prisma.workflow.delete({ where: { id, projectId } }).catch(() => {});
    }
  });

  // Helper to create a workflow
  async function createTestWorkflow(name: string) {
    const result = await caller.workflow.create({
      projectId,
      dsl: {
        spec_version: "1.2",
        name,
        description: "Test workflow",
        icon: "🔧",
        version: "1.0",
        default_llm: { model: "openai/gpt-4o" },
        nodes: [],
        edges: [],
        state: {},
      },
      commitMessage: "Initial commit",
    });
    createdWorkflowIds.push(result.workflow.id);
    return result.workflow;
  }

  // Helper to create an evaluator linked to a workflow
  async function createTestEvaluator(name: string, workflowId?: string) {
    const result = await caller.evaluators.create({
      projectId,
      name,
      type: workflowId ? "workflow" : "evaluator",
      config: workflowId ? {} : { evaluatorType: "langevals/exact_match" },
      workflowId,
    });
    createdEvaluatorIds.push(result.id);
    return result;
  }

  // Helper to create an agent linked to a workflow
  async function createTestAgent(name: string, workflowId?: string) {
    const result = await caller.agents.create({
      projectId,
      name,
      type: workflowId ? "workflow" : "code",
      config: workflowId
        ? { name, isCustom: true, workflow_id: workflowId }
        : {
            name,
            parameters: [{ identifier: "code", type: "code", value: "pass" }],
            inputs: [],
            outputs: [],
          },
      workflowId,
    });
    createdAgentIds.push(result.id);
    return result;
  }

  // Helper to create a monitor linked to an evaluator
  async function createTestMonitor(name: string, evaluatorId: string) {
    const monitor = await prisma.monitor.create({
      data: {
        id: `monitor_${nanoid()}`,
        projectId,
        name,
        slug: `${testNamespace}-${nanoid(5)}`,
        checkType: "custom",
        evaluatorId,
        executionMode: "ON_MESSAGE",
        preconditions: [],
        parameters: {},
      },
    });
    createdMonitorIds.push(monitor.id);
    return monitor;
  }

  describe("Workflow getRelatedEntities", () => {
    it("returns empty arrays when no related entities exist", async () => {
      const workflow = await createTestWorkflow(
        `${testNamespace}-no-relations`,
      );

      const result = await caller.workflow.getRelatedEntities({
        projectId,
        workflowId: workflow.id,
      });

      expect(result.evaluators).toHaveLength(0);
      expect(result.agents).toHaveLength(0);
      expect(result.monitors).toHaveLength(0);
    });

    it("returns linked evaluators", async () => {
      const workflow = await createTestWorkflow(
        `${testNamespace}-with-evaluator`,
      );
      await createTestEvaluator(
        `${testNamespace}-linked-evaluator`,
        workflow.id,
      );

      const result = await caller.workflow.getRelatedEntities({
        projectId,
        workflowId: workflow.id,
      });

      expect(result.evaluators).toHaveLength(1);
      expect(result.evaluators[0]?.name).toBe(
        `${testNamespace}-linked-evaluator`,
      );
    });

    it("returns linked agents", async () => {
      const workflow = await createTestWorkflow(`${testNamespace}-with-agent`);
      await createTestAgent(`${testNamespace}-linked-agent`, workflow.id);

      const result = await caller.workflow.getRelatedEntities({
        projectId,
        workflowId: workflow.id,
      });

      expect(result.agents).toHaveLength(1);
      expect(result.agents[0]?.name).toBe(`${testNamespace}-linked-agent`);
    });

    it("returns monitors linked to evaluators", async () => {
      const workflow = await createTestWorkflow(
        `${testNamespace}-with-monitor`,
      );
      const evaluator = await createTestEvaluator(
        `${testNamespace}-eval-with-monitor`,
        workflow.id,
      );
      await createTestMonitor(
        `${testNamespace}-linked-monitor`,
        evaluator.id,
      );

      const result = await caller.workflow.getRelatedEntities({
        projectId,
        workflowId: workflow.id,
      });

      expect(result.monitors).toHaveLength(1);
      expect(result.monitors[0]?.name).toBe(`${testNamespace}-linked-monitor`);
    });

    it("excludes already-archived evaluators", async () => {
      const workflow = await createTestWorkflow(
        `${testNamespace}-archived-eval`,
      );
      const evaluator = await createTestEvaluator(
        `${testNamespace}-will-archive`,
        workflow.id,
      );

      // Archive the evaluator
      await prisma.evaluator.update({
        where: { id: evaluator.id },
        data: { archivedAt: new Date() },
      });

      const result = await caller.workflow.getRelatedEntities({
        projectId,
        workflowId: workflow.id,
      });

      expect(result.evaluators).toHaveLength(0);
    });
  });

  describe("Workflow cascadeArchive", () => {
    it("archives workflow with no dependencies", async () => {
      const workflow = await createTestWorkflow(`${testNamespace}-simple`);

      const result = await caller.workflow.cascadeArchive({
        projectId,
        workflowId: workflow.id,
      });

      expect(result.workflow.archivedAt).not.toBeNull();
      expect(result.archivedEvaluatorsCount).toBe(0);
      expect(result.archivedAgentsCount).toBe(0);
      expect(result.deletedMonitorsCount).toBe(0);
    });

    it("archives workflow and linked evaluators", async () => {
      const workflow = await createTestWorkflow(`${testNamespace}-cascade-ev`);
      const evaluator = await createTestEvaluator(
        `${testNamespace}-to-archive`,
        workflow.id,
      );

      const result = await caller.workflow.cascadeArchive({
        projectId,
        workflowId: workflow.id,
      });

      expect(result.archivedEvaluatorsCount).toBe(1);

      // Verify evaluator was archived
      const archivedEvaluator = await prisma.evaluator.findUnique({
        where: { id: evaluator.id },
      });
      expect(archivedEvaluator?.archivedAt).not.toBeNull();
    });

    it("archives workflow and linked agents", async () => {
      const workflow = await createTestWorkflow(`${testNamespace}-cascade-ag`);
      const agent = await createTestAgent(
        `${testNamespace}-agent-to-archive`,
        workflow.id,
      );

      const result = await caller.workflow.cascadeArchive({
        projectId,
        workflowId: workflow.id,
      });

      expect(result.archivedAgentsCount).toBe(1);

      // Verify agent was archived
      const archivedAgent = await prisma.agent.findUnique({
        where: { id: agent.id },
      });
      expect(archivedAgent?.archivedAt).not.toBeNull();
    });

    it("deletes monitors when archiving evaluators", async () => {
      const workflow = await createTestWorkflow(
        `${testNamespace}-cascade-monitor`,
      );
      const evaluator = await createTestEvaluator(
        `${testNamespace}-eval-with-mon`,
        workflow.id,
      );
      const monitor = await createTestMonitor(
        `${testNamespace}-mon-to-delete`,
        evaluator.id,
      );

      const result = await caller.workflow.cascadeArchive({
        projectId,
        workflowId: workflow.id,
      });

      expect(result.deletedMonitorsCount).toBe(1);

      // Verify monitor was deleted (hard delete)
      const deletedMonitor = await prisma.monitor.findUnique({
        where: { id: monitor.id, projectId },
      });
      expect(deletedMonitor).toBeNull();

      // Remove from tracking since it's already deleted
      const idx = createdMonitorIds.indexOf(monitor.id);
      if (idx > -1) createdMonitorIds.splice(idx, 1);
    });
  });

  describe("Evaluator getRelatedEntities", () => {
    it("returns null workflow when not linked", async () => {
      const evaluator = await createTestEvaluator(
        `${testNamespace}-no-workflow`,
      );

      const result = await caller.evaluators.getRelatedEntities({
        projectId,
        id: evaluator.id,
      });

      expect(result.workflow).toBeNull();
      expect(result.monitors).toHaveLength(0);
    });

    it("returns linked workflow", async () => {
      const workflow = await createTestWorkflow(
        `${testNamespace}-eval-parent`,
      );
      const evaluator = await createTestEvaluator(
        `${testNamespace}-eval-child`,
        workflow.id,
      );

      const result = await caller.evaluators.getRelatedEntities({
        projectId,
        id: evaluator.id,
      });

      expect(result.workflow).not.toBeNull();
      expect(result.workflow?.name).toBe(`${testNamespace}-eval-parent`);
    });

    it("returns monitors using this evaluator", async () => {
      const evaluator = await createTestEvaluator(
        `${testNamespace}-eval-with-mons`,
      );
      await createTestMonitor(`${testNamespace}-mon-1`, evaluator.id);
      await createTestMonitor(`${testNamespace}-mon-2`, evaluator.id);

      const result = await caller.evaluators.getRelatedEntities({
        projectId,
        id: evaluator.id,
      });

      expect(result.monitors).toHaveLength(2);
    });
  });

  describe("Evaluator cascadeArchive", () => {
    it("archives evaluator with no dependencies", async () => {
      const evaluator = await createTestEvaluator(
        `${testNamespace}-eval-simple`,
      );

      const result = await caller.evaluators.cascadeArchive({
        projectId,
        id: evaluator.id,
      });

      expect(result.evaluator.archivedAt).not.toBeNull();
      expect(result.archivedWorkflow).toBeNull();
      expect(result.deletedMonitorsCount).toBe(0);
    });

    it("archives evaluator and deletes linked monitors", async () => {
      const evaluator = await createTestEvaluator(
        `${testNamespace}-eval-with-mons-2`,
      );
      const monitor = await createTestMonitor(
        `${testNamespace}-mon-del`,
        evaluator.id,
      );

      const result = await caller.evaluators.cascadeArchive({
        projectId,
        id: evaluator.id,
      });

      expect(result.deletedMonitorsCount).toBe(1);

      // Verify monitor was deleted
      const deletedMonitor = await prisma.monitor.findUnique({
        where: { id: monitor.id, projectId },
      });
      expect(deletedMonitor).toBeNull();

      // Remove from tracking
      const idx = createdMonitorIds.indexOf(monitor.id);
      if (idx > -1) createdMonitorIds.splice(idx, 1);
    });

    it("archives evaluator and linked workflow", async () => {
      const workflow = await createTestWorkflow(`${testNamespace}-wf-archive`);
      const evaluator = await createTestEvaluator(
        `${testNamespace}-eval-with-wf`,
        workflow.id,
      );

      const result = await caller.evaluators.cascadeArchive({
        projectId,
        id: evaluator.id,
      });

      expect(result.archivedWorkflow).not.toBeNull();
      expect(result.archivedWorkflow?.archivedAt).not.toBeNull();
    });
  });

  describe("Agent getRelatedEntities", () => {
    it("returns null workflow when not linked", async () => {
      const agent = await createTestAgent(`${testNamespace}-agent-no-wf`);

      const result = await caller.agents.getRelatedEntities({
        projectId,
        id: agent.id,
      });

      expect(result.workflow).toBeNull();
    });

    it("returns linked workflow", async () => {
      const workflow = await createTestWorkflow(
        `${testNamespace}-agent-parent`,
      );
      const agent = await createTestAgent(
        `${testNamespace}-agent-child`,
        workflow.id,
      );

      const result = await caller.agents.getRelatedEntities({
        projectId,
        id: agent.id,
      });

      expect(result.workflow).not.toBeNull();
      expect(result.workflow?.name).toBe(`${testNamespace}-agent-parent`);
    });
  });

  describe("Agent cascadeArchive", () => {
    it("archives agent with no dependencies", async () => {
      const agent = await createTestAgent(`${testNamespace}-agent-simple`);

      const result = await caller.agents.cascadeArchive({
        projectId,
        id: agent.id,
      });

      expect(result.agent.archivedAt).not.toBeNull();
      expect(result.archivedWorkflow).toBeNull();
    });

    it("archives agent and linked workflow", async () => {
      const workflow = await createTestWorkflow(
        `${testNamespace}-agent-wf-arch`,
      );
      const agent = await createTestAgent(
        `${testNamespace}-agent-with-wf`,
        workflow.id,
      );

      const result = await caller.agents.cascadeArchive({
        projectId,
        id: agent.id,
      });

      expect(result.archivedWorkflow).not.toBeNull();
      expect(result.archivedWorkflow?.archivedAt).not.toBeNull();
    });
  });
});
