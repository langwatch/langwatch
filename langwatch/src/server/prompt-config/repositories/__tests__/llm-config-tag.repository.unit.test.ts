import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  PromptTagAssignmentRepository,
  TagValidationError,
} from "../llm-config-tag.repository";

function makeMockPrisma(overrides: Record<string, unknown> = {}) {
  return {
    promptTagAssignment: {
      upsert: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    llmPromptConfigVersion: {
      findFirst: vi.fn(),
    },
    ...overrides,
  } as unknown as PrismaClient;
}

describe("PromptTagAssignmentRepository", () => {
  describe("validateTag()", () => {
    describe("when tag is 'production'", () => {
      it("does not throw", () => {
        const repo = new PromptTagAssignmentRepository(makeMockPrisma());

        expect(() => repo.validateTag("production")).not.toThrow();
      });
    });

    describe("when tag is 'staging'", () => {
      it("does not throw", () => {
        const repo = new PromptTagAssignmentRepository(makeMockPrisma());

        expect(() => repo.validateTag("staging")).not.toThrow();
      });
    });

    describe("when tag is a custom tag name", () => {
      it("does not throw", () => {
        const repo = new PromptTagAssignmentRepository(makeMockPrisma());

        expect(() => repo.validateTag("canary")).not.toThrow();
      });
    });

    describe("when tag is empty", () => {
      it("throws a validation error", () => {
        const repo = new PromptTagAssignmentRepository(makeMockPrisma());

        expect(() => repo.validateTag("")).toThrow(TagValidationError);
      });
    });
  });

  describe("assignTag()", () => {
    describe("when version does not belong to the prompt", () => {
      it("throws a validation error", async () => {
        const prisma = makeMockPrisma();
        (
          prisma.llmPromptConfigVersion.findFirst as ReturnType<typeof vi.fn>
        ).mockResolvedValue(null);
        const repo = new PromptTagAssignmentRepository(prisma);

        await expect(
          repo.assignTag({
            configId: "config-1",
            versionId: "version-from-other-prompt",
            tagId: "ptag_production",
            projectId: "project-1",
          }),
        ).rejects.toThrow(
          expect.objectContaining({
            name: "TagValidationError",
            message: expect.stringContaining(
              "Version does not belong to this prompt config",
            ),
          }),
        );
      });
    });

    describe("when tagId and version are valid", () => {
      it("assigns the tag to the version", async () => {
        const prisma = makeMockPrisma();
        (
          prisma.llmPromptConfigVersion.findFirst as ReturnType<typeof vi.fn>
        ).mockResolvedValue({ id: "v1", configId: "config-1" });
        const mockTag = {
          id: "vtag_abc",
          configId: "config-1",
          versionId: "v1",
          tagId: "ptag_production",
          projectId: "project-1",
          promptTag: { id: "ptag_production", name: "production" },
        };
        (
          prisma.promptTagAssignment.upsert as ReturnType<typeof vi.fn>
        ).mockResolvedValue(mockTag);
        const repo = new PromptTagAssignmentRepository(prisma);

        const result = await repo.assignTag({
          configId: "config-1",
          versionId: "v1",
          tagId: "ptag_production",
          projectId: "project-1",
          userId: "user-1",
        });

        expect(result).toEqual(mockTag);
        expect(prisma.promptTagAssignment.upsert).toHaveBeenCalledWith({
          where: {
            projectId: "project-1",
            configId_tagId: { configId: "config-1", tagId: "ptag_production" },
          },
          create: expect.objectContaining({
            configId: "config-1",
            versionId: "v1",
            tagId: "ptag_production",
            projectId: "project-1",
            createdById: "user-1",
            updatedById: "user-1",
          }),
          update: {
            versionId: "v1",
            updatedById: "user-1",
          },
          include: { promptTag: true },
        });
      });
    });
  });

  describe("getTagsForConfig()", () => {
    describe("when no tags are assigned", () => {
      it("returns an empty list", async () => {
        const prisma = makeMockPrisma();
        (
          prisma.promptTagAssignment.findMany as ReturnType<typeof vi.fn>
        ).mockResolvedValue([]);
        const repo = new PromptTagAssignmentRepository(prisma);

        const result = await repo.getTagsForConfig({
          configId: "config-1",
          projectId: "project-1",
        });

        expect(result).toEqual([]);
        expect(prisma.promptTagAssignment.findMany).toHaveBeenCalledWith({
          where: { configId: "config-1", projectId: "project-1" },
          include: { promptTag: true },
        });
      });
    });

    describe("when tags are assigned", () => {
      it("returns all tags for the config with their tag definitions", async () => {
        const prisma = makeMockPrisma();
        const mockTags = [
          {
            id: "vtag_1",
            configId: "config-1",
            versionId: "v2",
            tagId: "ptag_production",
            projectId: "project-1",
            promptTag: { id: "ptag_production", name: "production" },
          },
          {
            id: "vtag_2",
            configId: "config-1",
            versionId: "v3",
            tagId: "ptag_staging",
            projectId: "project-1",
            promptTag: { id: "ptag_staging", name: "staging" },
          },
        ];
        (
          prisma.promptTagAssignment.findMany as ReturnType<typeof vi.fn>
        ).mockResolvedValue(mockTags);
        const repo = new PromptTagAssignmentRepository(prisma);

        const result = await repo.getTagsForConfig({
          configId: "config-1",
          projectId: "project-1",
        });

        expect(result).toEqual(mockTags);
        expect(result).toHaveLength(2);
      });
    });
  });
});
