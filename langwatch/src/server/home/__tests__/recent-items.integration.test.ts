/**
 * @vitest-environment node
 *
 * Integration tests for Recent Items tRPC endpoint.
 * Tests the actual getRecentItems endpoint with real database queries.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getTestUser } from "../../../utils/testUtils";
import { appRouter } from "../../api/root";
import { createInnerTRPCContext } from "../../api/trpc";
import { prisma } from "../../db";

describe("Recent Items Integration", () => {
  const projectId = "test-project-id";
  let caller: ReturnType<typeof appRouter.createCaller>;
  let userId: string;
  let organizationId: string;
  const createdEntityIds: {
    auditLogs: string[];
    prompts: string[];
    workflows: string[];
    datasets: string[];
  } = {
    auditLogs: [],
    prompts: [],
    workflows: [],
    datasets: [],
  };

  beforeAll(async () => {
    const user = await getTestUser();
    userId = user.id;

    // Get the organization ID from the test project's team
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: { team: true },
    });
    organizationId = project?.team.organizationId ?? "";

    const ctx = createInnerTRPCContext({
      session: {
        user: { id: user.id },
        expires: "1",
      },
    });
    caller = appRouter.createCaller(ctx);
  });

  afterAll(async () => {
    // Clean up created entities in reverse order of creation
    if (createdEntityIds.auditLogs.length > 0) {
      await prisma.auditLog.deleteMany({
        where: { id: { in: createdEntityIds.auditLogs }, projectId },
      });
    }
    if (createdEntityIds.prompts.length > 0) {
      await prisma.llmPromptConfig.deleteMany({
        where: { id: { in: createdEntityIds.prompts }, projectId },
      });
    }
    if (createdEntityIds.workflows.length > 0) {
      await prisma.workflow.deleteMany({
        where: { id: { in: createdEntityIds.workflows }, projectId },
      });
    }
    if (createdEntityIds.datasets.length > 0) {
      await prisma.dataset.deleteMany({
        where: { id: { in: createdEntityIds.datasets }, projectId },
      });
    }
  });

  describe("home.getRecentItems", () => {
    it("returns empty array when user has no recent activity", async () => {
      const result = await caller.home.getRecentItems({
        projectId,
        limit: 12,
      });

      expect(Array.isArray(result)).toBe(true);
    });

    it("returns recent prompt from audit log", async () => {
      // Create a prompt
      const prompt = await prisma.llmPromptConfig.create({
        data: {
          id: `test-prompt-${Date.now()}`,
          name: "Test Prompt",
          projectId,
          organizationId,
        },
      });
      createdEntityIds.prompts.push(prompt.id);

      // Create an audit log entry for it
      const auditLog = await prisma.auditLog.create({
        data: {
          userId,
          projectId,
          action: "prompts.update",
          args: { configId: prompt.id },
        },
      });
      createdEntityIds.auditLogs.push(auditLog.id);

      const result = await caller.home.getRecentItems({
        projectId,
        limit: 12,
      });

      const promptItem = result.find((item) => item.id === prompt.id);
      expect(promptItem).toBeDefined();
      expect(promptItem?.type).toBe("prompt");
      expect(promptItem?.name).toBe("Test Prompt");
      expect(promptItem?.href?.includes("/prompts")).toBe(true);
    });

    it("returns recent workflow from audit log", async () => {
      // Create a workflow
      const workflow = await prisma.workflow.create({
        data: {
          id: `test-workflow-${Date.now()}`,
          name: "Test Workflow",
          icon: "🔄",
          description: "Test description",
          projectId,
        },
      });
      createdEntityIds.workflows.push(workflow.id);

      // Create an audit log entry for it
      const auditLog = await prisma.auditLog.create({
        data: {
          userId,
          projectId,
          action: "workflow.update",
          args: { workflowId: workflow.id },
        },
      });
      createdEntityIds.auditLogs.push(auditLog.id);

      const result = await caller.home.getRecentItems({
        projectId,
        limit: 12,
      });

      const workflowItem = result.find((item) => item.id === workflow.id);
      expect(workflowItem).toBeDefined();
      expect(workflowItem?.type).toBe("workflow");
      expect(workflowItem?.name).toBe("Test Workflow");
      expect(workflowItem?.href?.includes("/studio/")).toBe(true);
    });

    it("returns recent dataset from audit log", async () => {
      // Create a dataset
      const dataset = await prisma.dataset.create({
        data: {
          id: `test-dataset-${Date.now()}`,
          name: "Test Dataset",
          slug: `test-dataset-${Date.now()}`,
          projectId,
          columnTypes: {},
        },
      });
      createdEntityIds.datasets.push(dataset.id);

      // Create an audit log entry for it
      const auditLog = await prisma.auditLog.create({
        data: {
          userId,
          projectId,
          action: "dataset.update",
          args: { datasetId: dataset.id },
        },
      });
      createdEntityIds.auditLogs.push(auditLog.id);

      const result = await caller.home.getRecentItems({
        projectId,
        limit: 12,
      });

      const datasetItem = result.find((item) => item.id === dataset.id);
      expect(datasetItem).toBeDefined();
      expect(datasetItem?.type).toBe("dataset");
      expect(datasetItem?.name).toBe("Test Dataset");
      expect(datasetItem?.href?.includes("/datasets/")).toBe(true);
    });

    it("excludes deleted prompts from results", async () => {
      // Create a deleted prompt
      const deletedPrompt = await prisma.llmPromptConfig.create({
        data: {
          id: `deleted-prompt-${Date.now()}`,
          name: "Deleted Prompt",
          projectId,
          organizationId,
          deletedAt: new Date(),
        },
      });
      createdEntityIds.prompts.push(deletedPrompt.id);

      // Create an audit log entry for it
      const auditLog = await prisma.auditLog.create({
        data: {
          userId,
          projectId,
          action: "prompts.update",
          args: { configId: deletedPrompt.id },
        },
      });
      createdEntityIds.auditLogs.push(auditLog.id);

      const result = await caller.home.getRecentItems({
        projectId,
        limit: 12,
      });

      const deletedItem = result.find((item) => item.id === deletedPrompt.id);
      expect(deletedItem).toBeUndefined();
    });

    it("excludes archived workflows from results", async () => {
      // Create an archived workflow
      const archivedWorkflow = await prisma.workflow.create({
        data: {
          id: `archived-workflow-${Date.now()}`,
          name: "Archived Workflow",
          icon: "📁",
          description: "Archived description",
          projectId,
          archivedAt: new Date(),
        },
      });
      createdEntityIds.workflows.push(archivedWorkflow.id);

      // Create an audit log entry for it
      const auditLog = await prisma.auditLog.create({
        data: {
          userId,
          projectId,
          action: "workflow.update",
          args: { workflowId: archivedWorkflow.id },
        },
      });
      createdEntityIds.auditLogs.push(auditLog.id);

      const result = await caller.home.getRecentItems({
        projectId,
        limit: 12,
      });

      const archivedItem = result.find(
        (item) => item.id === archivedWorkflow.id,
      );
      expect(archivedItem).toBeUndefined();
    });

    it("respects the limit parameter", async () => {
      const result = await caller.home.getRecentItems({
        projectId,
        limit: 2,
      });

      expect(result.length).toBeLessThanOrEqual(2);
    });
  });
});
