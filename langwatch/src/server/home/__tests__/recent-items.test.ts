/**
 * @vitest-environment node
 *
 * Integration tests for Recent Items tRPC endpoint.
 * Tests the actual getRecentItems endpoint with real database queries.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getTestUser } from "../../../utils/testUtils";
import { prisma } from "../../db";
import { appRouter } from "../../api/root";
import { createInnerTRPCContext } from "../../api/trpc";

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
    it("returns an array", async () => {
      const result = await caller.home.getRecentItems({
        projectId,
        limit: 12,
      });

      expect(Array.isArray(result)).toBe(true);
    });

    it("returns items with expected structure when data exists", async () => {
      // Create a prompt
      const promptId = `test-prompt-${Date.now()}-${Math.random()}`;
      const prompt = await prisma.llmPromptConfig.create({
        data: {
          id: promptId,
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

      // Should return at least one item
      expect(result.length).toBeGreaterThanOrEqual(1);

      // Each item should have the expected structure
      for (const item of result) {
        expect(item).toHaveProperty("id");
        expect(item).toHaveProperty("type");
        expect(item).toHaveProperty("name");
        expect(item).toHaveProperty("href");
        expect(item).toHaveProperty("updatedAt");
      }
    });

    it("excludes deleted prompts from results", async () => {
      // Create a deleted prompt
      const deletedPromptId = `deleted-prompt-${Date.now()}-${Math.random()}`;
      const deletedPrompt = await prisma.llmPromptConfig.create({
        data: {
          id: deletedPromptId,
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
      const archivedWorkflowId = `archived-workflow-${Date.now()}-${Math.random()}`;
      const archivedWorkflow = await prisma.workflow.create({
        data: {
          id: archivedWorkflowId,
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
