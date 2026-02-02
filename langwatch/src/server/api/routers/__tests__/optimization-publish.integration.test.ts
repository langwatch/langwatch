/**
 * @vitest-environment node
 *
 * Integration tests for Optimization Router publish functionality.
 * Tests the evaluator creation/update when publishing workflow evaluators.
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getTestUser } from "../../../../utils/testUtils";
import { prisma } from "../../../db";
import { appRouter } from "../../root";
import { createInnerTRPCContext } from "../../trpc";

// Mock license enforcement to avoid limits during tests
vi.mock("../../../license-enforcement", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../license-enforcement")>();
  return {
    ...actual,
    enforceLicenseLimit: vi.fn().mockResolvedValue(undefined),
  };
});

describe("Optimization Publish - Evaluator Integration", () => {
  const projectId = "test-project-id";
  let caller: ReturnType<typeof appRouter.createCaller>;
  const createdWorkflowIds: string[] = [];
  const createdEvaluatorIds: string[] = [];

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

  beforeEach(async () => {
    // Clean up any evaluators linked to our test workflows
    await prisma.evaluator.deleteMany({
      where: {
        projectId,
        workflowId: { in: createdWorkflowIds },
      },
    });
  });

  afterAll(async () => {
    // Clean up all created workflows and evaluators
    if (createdEvaluatorIds.length > 0) {
      await prisma.evaluator.deleteMany({
        where: {
          projectId,
          id: { in: createdEvaluatorIds },
        },
      });
    }
    if (createdWorkflowIds.length > 0) {
      await prisma.workflow.deleteMany({
        where: {
          projectId,
          id: { in: createdWorkflowIds },
        },
      });
    }
  });

  /**
   * Helper to create a test workflow
   */
  const createTestWorkflow = async (name: string) => {
    const workflowId = `workflow_${nanoid()}`;
    const workflow = await prisma.workflow.create({
      data: {
        id: workflowId,
        projectId,
        name,
        icon: "🧪",
        description: "Test workflow",
        isComponent: false,
        isEvaluator: false,
      },
    });
    createdWorkflowIds.push(workflowId);
    return workflow;
  };

  describe("toggleSaveAsEvaluator", () => {
    it("creates an Evaluator record when publishing workflow as evaluator", async () => {
      // Create a workflow
      const workflow = await createTestWorkflow("Bias Detection Evaluator");

      // Toggle save as evaluator
      const result = await caller.optimization.toggleSaveAsEvaluator({
        workflowId: workflow.id,
        projectId,
        isEvaluator: true,
        isComponent: false,
      });

      expect(result.success).toBe(true);

      // Verify workflow flags are updated
      const updatedWorkflow = await prisma.workflow.findFirst({
        where: { id: workflow.id, projectId },
      });
      expect(updatedWorkflow?.isEvaluator).toBe(true);
      expect(updatedWorkflow?.isComponent).toBe(false);

      // Verify evaluator was created
      const evaluator = await prisma.evaluator.findFirst({
        where: {
          workflowId: workflow.id,
          projectId,
          archivedAt: null,
        },
      });

      expect(evaluator).not.toBeNull();
      expect(evaluator?.name).toBe("Bias Detection Evaluator");
      expect(evaluator?.type).toBe("workflow");
      expect(evaluator?.workflowId).toBe(workflow.id);
      expect(evaluator?.slug).toMatch(/^bias-detection-evaluator-[a-z0-9]{5}$/);

      createdEvaluatorIds.push(evaluator!.id);
    });

    it("updates existing Evaluator name when re-publishing with changed workflow name", async () => {
      // Create a workflow
      const workflow = await createTestWorkflow("Original Name");

      // First publish
      await caller.optimization.toggleSaveAsEvaluator({
        workflowId: workflow.id,
        projectId,
        isEvaluator: true,
        isComponent: false,
      });

      // Get the evaluator
      const evaluator = await prisma.evaluator.findFirst({
        where: { workflowId: workflow.id, projectId, archivedAt: null },
      });
      expect(evaluator?.name).toBe("Original Name");
      createdEvaluatorIds.push(evaluator!.id);

      // Update workflow name
      await prisma.workflow.update({
        where: { id: workflow.id, projectId },
        data: { name: "Updated Name" },
      });

      // Re-publish
      await caller.optimization.toggleSaveAsEvaluator({
        workflowId: workflow.id,
        projectId,
        isEvaluator: true,
        isComponent: false,
      });

      // Verify evaluator name was updated
      const updatedEvaluator = await prisma.evaluator.findFirst({
        where: { id: evaluator!.id, projectId },
      });
      expect(updatedEvaluator?.name).toBe("Updated Name");
    });

    it("does not create duplicate evaluators when publishing multiple times", async () => {
      const workflow = await createTestWorkflow("No Duplicates Test");

      // Publish multiple times
      await caller.optimization.toggleSaveAsEvaluator({
        workflowId: workflow.id,
        projectId,
        isEvaluator: true,
        isComponent: false,
      });

      await caller.optimization.toggleSaveAsEvaluator({
        workflowId: workflow.id,
        projectId,
        isEvaluator: true,
        isComponent: false,
      });

      await caller.optimization.toggleSaveAsEvaluator({
        workflowId: workflow.id,
        projectId,
        isEvaluator: true,
        isComponent: false,
      });

      // Should only have one evaluator
      const evaluators = await prisma.evaluator.findMany({
        where: {
          workflowId: workflow.id,
          projectId,
          archivedAt: null,
        },
      });

      expect(evaluators).toHaveLength(1);
      createdEvaluatorIds.push(evaluators[0]!.id);
    });

    it("does not create evaluator when isEvaluator is false", async () => {
      const workflow = await createTestWorkflow("Not An Evaluator");

      await caller.optimization.toggleSaveAsEvaluator({
        workflowId: workflow.id,
        projectId,
        isEvaluator: false,
        isComponent: true,
      });

      const evaluator = await prisma.evaluator.findFirst({
        where: {
          workflowId: workflow.id,
          projectId,
          archivedAt: null,
        },
      });

      expect(evaluator).toBeNull();
    });
  });

  describe("disableAsEvaluator", () => {
    it("archives the linked Evaluator when unpublishing", async () => {
      // Create and publish workflow as evaluator
      const workflow = await createTestWorkflow("Will Be Unpublished");

      await caller.optimization.toggleSaveAsEvaluator({
        workflowId: workflow.id,
        projectId,
        isEvaluator: true,
        isComponent: false,
      });

      const evaluator = await prisma.evaluator.findFirst({
        where: { workflowId: workflow.id, projectId, archivedAt: null },
      });
      expect(evaluator).not.toBeNull();
      createdEvaluatorIds.push(evaluator!.id);

      // Disable as evaluator
      await caller.optimization.disableAsEvaluator({
        workflowId: workflow.id,
        projectId,
      });

      // Verify workflow flag is updated
      const updatedWorkflow = await prisma.workflow.findFirst({
        where: { id: workflow.id, projectId },
      });
      expect(updatedWorkflow?.isEvaluator).toBe(false);

      // Verify evaluator was archived
      const archivedEvaluator = await prisma.evaluator.findFirst({
        where: { id: evaluator!.id, projectId },
      });
      expect(archivedEvaluator?.archivedAt).not.toBeNull();
    });

    it("evaluator is excluded from getAll after unpublishing", async () => {
      const workflow = await createTestWorkflow("Hidden After Unpublish");

      await caller.optimization.toggleSaveAsEvaluator({
        workflowId: workflow.id,
        projectId,
        isEvaluator: true,
        isComponent: false,
      });

      const evaluator = await prisma.evaluator.findFirst({
        where: { workflowId: workflow.id, projectId, archivedAt: null },
      });
      createdEvaluatorIds.push(evaluator!.id);

      // Verify it's in the list
      const beforeList = await caller.evaluators.getAll({ projectId });
      expect(beforeList.some((e) => e.id === evaluator!.id)).toBe(true);

      // Disable
      await caller.optimization.disableAsEvaluator({
        workflowId: workflow.id,
        projectId,
      });

      // Verify it's no longer in the list
      const afterList = await caller.evaluators.getAll({ projectId });
      expect(afterList.some((e) => e.id === evaluator!.id)).toBe(false);
    });
  });

  describe("re-publishing after unpublish", () => {
    it("creates a new Evaluator when re-publishing after unpublish", async () => {
      const workflow = await createTestWorkflow("Republish Test");

      // First publish
      await caller.optimization.toggleSaveAsEvaluator({
        workflowId: workflow.id,
        projectId,
        isEvaluator: true,
        isComponent: false,
      });

      const firstEvaluator = await prisma.evaluator.findFirst({
        where: { workflowId: workflow.id, projectId, archivedAt: null },
      });
      createdEvaluatorIds.push(firstEvaluator!.id);

      // Unpublish
      await caller.optimization.disableAsEvaluator({
        workflowId: workflow.id,
        projectId,
      });

      // Re-publish
      await caller.optimization.toggleSaveAsEvaluator({
        workflowId: workflow.id,
        projectId,
        isEvaluator: true,
        isComponent: false,
      });

      // Should have a new evaluator (the old one is archived)
      const newEvaluator = await prisma.evaluator.findFirst({
        where: { workflowId: workflow.id, projectId, archivedAt: null },
      });

      expect(newEvaluator).not.toBeNull();
      expect(newEvaluator?.id).not.toBe(firstEvaluator!.id);
      createdEvaluatorIds.push(newEvaluator!.id);

      // Old evaluator should still be archived
      const oldEvaluator = await prisma.evaluator.findFirst({
        where: { id: firstEvaluator!.id, projectId },
      });
      expect(oldEvaluator?.archivedAt).not.toBeNull();
    });
  });

  describe("evaluator slug for guardrails API", () => {
    it("generated slug can be used to fetch the evaluator", async () => {
      const workflow = await createTestWorkflow("Guardrail Friendly");

      await caller.optimization.toggleSaveAsEvaluator({
        workflowId: workflow.id,
        projectId,
        isEvaluator: true,
        isComponent: false,
      });

      const evaluator = await prisma.evaluator.findFirst({
        where: { workflowId: workflow.id, projectId, archivedAt: null },
      });
      createdEvaluatorIds.push(evaluator!.id);

      // Fetch by slug
      const foundBySlug = await caller.evaluators.getBySlug({
        slug: evaluator!.slug!,
        projectId,
      });

      expect(foundBySlug?.id).toBe(evaluator!.id);
      expect(foundBySlug?.workflowId).toBe(workflow.id);
    });
  });
});
