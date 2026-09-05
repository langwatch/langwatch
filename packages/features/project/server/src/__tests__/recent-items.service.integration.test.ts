/**
 * @vitest-environment node
 * @see specs/home/recent-items-backend.feature
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
  type PrismaConnection,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { PrismaRecentItemsRepository } from "../repositories/prisma/prisma.recent-items.repository";
import { RecentItemsService } from "../services/recent-items.service";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

const testNamespace = `recent-items-${nanoid(8)}`;

describe.skipIf(!DB_URL)("given a project with an audit-log trail", () => {
  const connection: PrismaConnection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  const prisma = connection.client as PrismaClient;
  const service = RecentItemsService.create({
    repository: PrismaRecentItemsRepository.create({ prisma }),
  });

  let organizationId: string;
  let teamId: string;
  let userId: string;
  let projectId: string;
  let otherProjectId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { name: "Recent Items User", email: `user-${testNamespace}@example.com` },
    });
    userId = user.id;

    const organization = await prisma.organization.create({
      data: { name: `ACME ${testNamespace}`, slug: `--test-org-${testNamespace}` },
    });
    organizationId = organization.id;

    const team = await prisma.team.create({
      data: { name: `ACME ${testNamespace}`, slug: `--test-team-${testNamespace}`, organizationId },
    });
    teamId = team.id;

    const project = await prisma.project.create({
      data: {
        name: "Recent Items Project",
        slug: `--test-proj-${testNamespace}`,
        apiKey: `sk-lw-test-${nanoid(16)}`,
        teamId,
        language: "en",
        framework: "test",
      },
    });
    projectId = project.id;

    const otherProject = await prisma.project.create({
      data: {
        name: "Other Project",
        slug: `--test-proj-other-${testNamespace}`,
        apiKey: `sk-lw-test-${nanoid(16)}`,
        teamId,
        language: "en",
        framework: "test",
      },
    });
    otherProjectId = otherProject.id;
  });

  afterAll(async () => {
    if (!organizationId) return;
    await prisma.auditLog.deleteMany({ where: { projectId: { in: [projectId, otherProjectId] } } });
    await prisma.llmPromptConfig.deleteMany({ where: { projectId } });
    await prisma.workflow.deleteMany({ where: { projectId } });
    await prisma.dataset.deleteMany({ where: { projectId } });
    await prisma.project.deleteMany({ where: { teamId } });
    await prisma.team.deleteMany({ where: { organizationId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  /** @scenario Returns empty array when user has no recent activity */
  it("returns an empty array when the user has no recent activity", async () => {
    const otherUser = await prisma.user.create({
      data: { name: "Quiet User", email: `quiet-${testNamespace}@example.com` },
    });
    try {
      const result = await service.getRecentItems({
        userId: otherUser.id,
        projectId,
        limit: 12,
      });
      expect(result).toEqual([]);
    } finally {
      await prisma.user.delete({ where: { id: otherUser.id } });
    }
  });

  describe("when a prompt has been touched", () => {
    /** @scenario Extracts prompt IDs from prompts.update actions */
    /** @scenario Hydrates items with entity name and updatedAt */
    it("extracts and hydrates the prompt from a prompts.update action", async () => {
      const prompt = await prisma.llmPromptConfig.create({
        data: {
          id: `prompt-${testNamespace}-update`,
          name: "My Prompt",
          projectId,
          organizationId,
        },
      });
      await prisma.auditLog.create({
        data: { userId, projectId, action: "prompts.update", args: { configId: prompt.id } },
      });

      const result = await service.getRecentItems({ userId, projectId, limit: 12 });

      const item = result.find((i) => i.id === prompt.id);
      expect(item).toMatchObject({ type: "prompt", id: prompt.id, name: "My Prompt" });
      expect(item?.href).toContain("/prompts");
      expect(item?.updatedAt).toBeInstanceOf(Date);
    });

    /** @scenario Extracts prompt IDs from prompts.create actions */
    it("extracts the prompt from a prompts.create action", async () => {
      const prompt = await prisma.llmPromptConfig.create({
        data: {
          id: `prompt-${testNamespace}-create`,
          name: "New Prompt",
          projectId,
          organizationId,
        },
      });
      await prisma.auditLog.create({
        data: { userId, projectId, action: "prompts.create", args: { configId: prompt.id } },
      });

      const result = await service.getRecentItems({ userId, projectId, limit: 12 });

      expect(result.find((i) => i.id === prompt.id)).toMatchObject({
        type: "prompt",
        name: "New Prompt",
      });
    });

    /** @scenario Excludes soft-deleted prompts from results */
    it("excludes a soft-deleted prompt from the results", async () => {
      const deletedPrompt = await prisma.llmPromptConfig.create({
        data: {
          id: `prompt-${testNamespace}-deleted`,
          name: "Deleted Prompt",
          projectId,
          organizationId,
          deletedAt: new Date(),
        },
      });
      await prisma.auditLog.create({
        data: {
          userId,
          projectId,
          action: "prompts.update",
          args: { configId: deletedPrompt.id },
        },
      });

      const result = await service.getRecentItems({ userId, projectId, limit: 12 });

      expect(result.find((i) => i.id === deletedPrompt.id)).toBeUndefined();
    });
  });

  describe("when a workflow has been touched", () => {
    /** @scenario Extracts workflow IDs from workflow.update actions */
    it("extracts the workflow from a workflow.update action", async () => {
      const workflow = await prisma.workflow.create({
        data: {
          id: `workflow-${testNamespace}-update`,
          name: "My Workflow",
          icon: "🔄",
          description: "test",
          projectId,
        },
      });
      await prisma.auditLog.create({
        data: { userId, projectId, action: "workflow.update", args: { workflowId: workflow.id } },
      });

      const result = await service.getRecentItems({ userId, projectId, limit: 12 });

      const item = result.find((i) => i.id === workflow.id);
      expect(item).toMatchObject({ type: "workflow", name: "My Workflow" });
      expect(item?.href).toContain("/studio/");
    });

    /** @scenario Extracts workflow IDs from workflow.create actions */
    it("extracts the workflow from a workflow.create action", async () => {
      const workflow = await prisma.workflow.create({
        data: {
          id: `workflow-${testNamespace}-create`,
          name: "New Workflow",
          icon: "⚡",
          description: "test",
          projectId,
        },
      });
      await prisma.auditLog.create({
        data: { userId, projectId, action: "workflow.create", args: { workflowId: workflow.id } },
      });

      const result = await service.getRecentItems({ userId, projectId, limit: 12 });

      expect(result.find((i) => i.id === workflow.id)).toMatchObject({
        type: "workflow",
        name: "New Workflow",
      });
    });

    /** @scenario Excludes archived workflows from results */
    it("excludes an archived workflow from the results", async () => {
      const archivedWorkflow = await prisma.workflow.create({
        data: {
          id: `workflow-${testNamespace}-archived`,
          name: "Archived Workflow",
          icon: "📁",
          description: "test",
          projectId,
          archivedAt: new Date(),
        },
      });
      await prisma.auditLog.create({
        data: {
          userId,
          projectId,
          action: "workflow.update",
          args: { workflowId: archivedWorkflow.id },
        },
      });

      const result = await service.getRecentItems({ userId, projectId, limit: 12 });

      expect(result.find((i) => i.id === archivedWorkflow.id)).toBeUndefined();
    });
  });

  describe("when a dataset has been touched", () => {
    /** @scenario Extracts dataset IDs from dataset.update actions */
    it("extracts the dataset from a dataset.update action", async () => {
      const dataset = await prisma.dataset.create({
        data: {
          id: `dataset-${testNamespace}-update`,
          name: "My Dataset",
          slug: `dataset-${testNamespace}-update`,
          projectId,
          columnTypes: {},
        },
      });
      await prisma.auditLog.create({
        data: { userId, projectId, action: "dataset.update", args: { datasetId: dataset.id } },
      });

      const result = await service.getRecentItems({ userId, projectId, limit: 12 });

      const item = result.find((i) => i.id === dataset.id);
      expect(item).toMatchObject({ type: "dataset", name: "My Dataset" });
      expect(item?.href).toContain("/datasets/");
    });

    /** @scenario Extracts dataset IDs from dataset.create actions */
    it("extracts the dataset from a dataset.create action", async () => {
      const dataset = await prisma.dataset.create({
        data: {
          id: `dataset-${testNamespace}-create`,
          name: "New Dataset",
          slug: `dataset-${testNamespace}-create`,
          projectId,
          columnTypes: {},
        },
      });
      await prisma.auditLog.create({
        data: { userId, projectId, action: "dataset.create", args: { datasetId: dataset.id } },
      });

      const result = await service.getRecentItems({ userId, projectId, limit: 12 });

      expect(result.find((i) => i.id === dataset.id)).toMatchObject({
        type: "dataset",
        name: "New Dataset",
      });
    });
  });

  /** @scenario Returns items from AuditLog filtered by user and project */
  it("only returns items from the requesting user's own audit log in this project", async () => {
    const otherUser = await prisma.user.create({
      data: { name: "Other User", email: `other-${testNamespace}@example.com` },
    });
    const myPrompt = await prisma.llmPromptConfig.create({
      data: { id: `prompt-${testNamespace}-mine`, name: "Mine", projectId, organizationId },
    });
    const otherUsersPrompt = await prisma.llmPromptConfig.create({
      data: {
        id: `prompt-${testNamespace}-theirs`,
        name: "Theirs",
        projectId,
        organizationId,
      },
    });
    const otherProjectPrompt = await prisma.llmPromptConfig.create({
      data: {
        id: `prompt-${testNamespace}-other-project`,
        name: "Other project",
        projectId: otherProjectId,
        organizationId,
      },
    });

    try {
      await prisma.auditLog.create({
        data: { userId, projectId, action: "prompts.update", args: { configId: myPrompt.id } },
      });
      await prisma.auditLog.create({
        data: {
          userId: otherUser.id,
          projectId,
          action: "prompts.update",
          args: { configId: otherUsersPrompt.id },
        },
      });
      await prisma.auditLog.create({
        data: {
          userId,
          projectId: otherProjectId,
          action: "prompts.update",
          args: { configId: otherProjectPrompt.id },
        },
      });

      const result = await service.getRecentItems({ userId, projectId, limit: 12 });

      expect(result.some((i) => i.id === myPrompt.id)).toBe(true);
      expect(result.some((i) => i.id === otherUsersPrompt.id)).toBe(false);
      expect(result.some((i) => i.id === otherProjectPrompt.id)).toBe(false);
    } finally {
      await prisma.llmPromptConfig.deleteMany({
        where: { id: { in: [otherUsersPrompt.id, otherProjectPrompt.id] } },
      });
      await prisma.user.delete({ where: { id: otherUser.id } });
    }
  });

  /** @scenario Limits results to requested count */
  it("limits results to the requested count", async () => {
    const prompts = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        prisma.llmPromptConfig.create({
          data: {
            id: `prompt-${testNamespace}-limit-${i}`,
            name: `Limit Prompt ${i}`,
            projectId,
            organizationId,
          },
        }),
      ),
    );
    await Promise.all(
      prompts.map((prompt) =>
        prisma.auditLog.create({
          data: { userId, projectId, action: "prompts.update", args: { configId: prompt.id } },
        }),
      ),
    );

    const result = await service.getRecentItems({ userId, projectId, limit: 5 });

    expect(result.length).toBeLessThanOrEqual(5);
  });
});
