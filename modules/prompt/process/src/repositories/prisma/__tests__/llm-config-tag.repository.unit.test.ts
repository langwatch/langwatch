import { describe, expect, it, vi } from "vitest";

import {
  PrismaPromptTagAssignmentRepository,
  type PromptTagAssignmentDatabase,
} from "../prisma.prompt-tag-assignment.repository.ts";

/**
 * The individual mocks are returned alongside the typed `prisma` value so
 * assertions can inspect a mock's own call history directly, rather than
 * extracting a generated Prisma client member as an unbound method.
 */
function makeMockPrisma(overrides: Record<string, unknown> = {}) {
  const upsert = vi.fn();
  const findFirst = vi.fn();
  const findMany = vi.fn();
  const versionFindFirst = vi.fn();
  const prisma = {
    promptTagAssignment: { upsert, findFirst, findMany },
    llmPromptConfigVersion: { findFirst: versionFindFirst },
    ...overrides,
  } as unknown as PromptTagAssignmentDatabase;
  return { prisma, upsert, findFirst, findMany, versionFindFirst };
}

describe("PrismaPromptTagAssignmentRepository", () => {
  describe("assignTag()", () => {
    describe("when version does not belong to the prompt", () => {
      /** @scenario "An invalid tag assignment is refused by name" */
      it("throws a validation error", async () => {
        const { prisma, versionFindFirst } = makeMockPrisma();
        versionFindFirst.mockResolvedValue(null);
        const repo = PrismaPromptTagAssignmentRepository.create({ prisma });

        await expect(
          repo.assignTag({
            configId: "config-1",
            versionId: "version-from-other-prompt",
            tagId: "ptag_production",
            projectId: "project-1",
          }),
        ).rejects.toThrow(
          // The stable code, not the class name: this refusal is handled, and
          // the code is what a caller reads off the wire.
          expect.objectContaining({
            code: "prompt_tag_invalid",
            message: expect.stringContaining("Version does not belong to this prompt config"),
          }),
        );
      });
    });

    describe("when tagId and version are valid", () => {
      it("assigns the tag to the version", async () => {
        const { prisma, versionFindFirst, upsert } = makeMockPrisma();
        versionFindFirst.mockResolvedValue({
          id: "v1",
          configId: "config-1",
        });
        const mockTag = {
          id: "vtag_abc",
          configId: "config-1",
          versionId: "v1",
          tagId: "ptag_production",
          projectId: "project-1",
          promptTag: { id: "ptag_production", name: "production" },
        };
        upsert.mockResolvedValue(mockTag);
        const repo = PrismaPromptTagAssignmentRepository.create({ prisma });

        const result = await repo.assignTag({
          configId: "config-1",
          versionId: "v1",
          tagId: "ptag_production",
          projectId: "project-1",
          userId: "user-1",
        });

        expect(result).toEqual(mockTag);
        expect(upsert).toHaveBeenCalledWith({
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
      /** @scenario getLabelsForConfig returns empty when no labels assigned */
      it("returns an empty list", async () => {
        const { prisma, findMany } = makeMockPrisma();
        findMany.mockResolvedValue([]);
        const repo = PrismaPromptTagAssignmentRepository.create({ prisma });

        const result = await repo.findTagsForConfig({
          configId: "config-1",
          projectId: "project-1",
        });

        expect(result).toEqual([]);
        expect(findMany).toHaveBeenCalledWith({
          where: { configId: "config-1", projectId: "project-1" },
          include: { promptTag: true },
        });
      });
    });

    describe("when tags are assigned", () => {
      /** @scenario "Fetch all labels for a prompt config" */
      it("returns all tags for the config with their tag definitions", async () => {
        const { prisma, findMany } = makeMockPrisma();
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
        findMany.mockResolvedValue(mockTags);
        const repo = PrismaPromptTagAssignmentRepository.create({ prisma });

        const result = await repo.findTagsForConfig({
          configId: "config-1",
          projectId: "project-1",
        });

        expect(result).toEqual(mockTags);
        expect(result).toHaveLength(2);
      });
    });
  });
});
