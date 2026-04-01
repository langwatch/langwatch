import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  PromptVersionTagRepository,
  TagValidationError,
} from "../llm-config-tag.repository";

function makeMockPrisma(overrides: Record<string, unknown> = {}) {
  return {
    promptVersionTag: {
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

describe("PromptVersionTagRepository", () => {
  describe("validateTag()", () => {
    describe("when tag is 'production'", () => {
      it("does not throw", () => {
        const repo = new PromptVersionTagRepository(makeMockPrisma());

        expect(() => repo.validateTag("production")).not.toThrow();
      });
    });

    describe("when tag is 'staging'", () => {
      it("does not throw", () => {
        const repo = new PromptVersionTagRepository(makeMockPrisma());

        expect(() => repo.validateTag("staging")).not.toThrow();
      });
    });

    describe("when tag is 'canary'", () => {
      it("throws a validation error", () => {
        const repo = new PromptVersionTagRepository(makeMockPrisma());

        expect(() => repo.validateTag("canary")).toThrow(
          expect.objectContaining({
            name: "TagValidationError",
            message: expect.stringContaining('Invalid tag "canary"'),
          }),
        );
      });
    });

    describe("when tag is 'latest'", () => {
      it("throws a validation error", () => {
        const repo = new PromptVersionTagRepository(makeMockPrisma());

        expect(() => repo.validateTag("latest")).toThrow(
          TagValidationError,
        );
      });
    });

    describe("when tag is an arbitrary string", () => {
      it("throws a validation error", () => {
        const repo = new PromptVersionTagRepository(makeMockPrisma());

        expect(() => repo.validateTag("custom-release")).toThrow(
          TagValidationError,
        );
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
        const repo = new PromptVersionTagRepository(prisma);

        await expect(
          repo.assignTag({
            configId: "config-1",
            versionId: "version-from-other-prompt",
            tag: "production",
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

    describe("when tag is invalid", () => {
      it("throws a validation error without hitting the database", async () => {
        const prisma = makeMockPrisma();
        const repo = new PromptVersionTagRepository(prisma);

        await expect(
          repo.assignTag({
            configId: "config-1",
            versionId: "v1",
            tag: "canary",
            projectId: "project-1",
          }),
        ).rejects.toThrow(TagValidationError);

        expect(
          prisma.llmPromptConfigVersion.findFirst,
        ).not.toHaveBeenCalled();
      });
    });

    describe("when tag and version are valid", () => {
      it("assigns the tag to the version", async () => {
        const prisma = makeMockPrisma();
        (
          prisma.llmPromptConfigVersion.findFirst as ReturnType<typeof vi.fn>
        ).mockResolvedValue({ id: "v1", configId: "config-1" });
        const mockTag = {
          id: "vtag_abc",
          configId: "config-1",
          versionId: "v1",
          tag: "production",
          projectId: "project-1",
        };
        (
          prisma.promptVersionTag.upsert as ReturnType<typeof vi.fn>
        ).mockResolvedValue(mockTag);
        const repo = new PromptVersionTagRepository(prisma);

        const result = await repo.assignTag({
          configId: "config-1",
          versionId: "v1",
          tag: "production",
          projectId: "project-1",
          userId: "user-1",
        });

        expect(result).toEqual(mockTag);
        expect(prisma.promptVersionTag.upsert).toHaveBeenCalledWith({
          where: {
            projectId: "project-1",
            configId_tag: { configId: "config-1", tag: "production" },
          },
          create: expect.objectContaining({
            configId: "config-1",
            versionId: "v1",
            tag: "production",
            projectId: "project-1",
            createdById: "user-1",
            updatedById: "user-1",
          }),
          update: {
            versionId: "v1",
            updatedById: "user-1",
          },
        });
      });
    });
  });

  describe("getTagsForConfig()", () => {
    describe("when no tags are assigned", () => {
      it("returns an empty list", async () => {
        const prisma = makeMockPrisma();
        (
          prisma.promptVersionTag.findMany as ReturnType<typeof vi.fn>
        ).mockResolvedValue([]);
        const repo = new PromptVersionTagRepository(prisma);

        const result = await repo.getTagsForConfig({
          configId: "config-1",
          projectId: "project-1",
        });

        expect(result).toEqual([]);
        expect(prisma.promptVersionTag.findMany).toHaveBeenCalledWith({
          where: { configId: "config-1", projectId: "project-1" },
        });
      });
    });

    describe("when tags are assigned", () => {
      it("returns all tags for the config", async () => {
        const prisma = makeMockPrisma();
        const mockTags = [
          {
            id: "vtag_1",
            configId: "config-1",
            versionId: "v2",
            tag: "production",
            projectId: "project-1",
          },
          {
            id: "vtag_2",
            configId: "config-1",
            versionId: "v3",
            tag: "staging",
            projectId: "project-1",
          },
        ];
        (
          prisma.promptVersionTag.findMany as ReturnType<typeof vi.fn>
        ).mockResolvedValue(mockTags);
        const repo = new PromptVersionTagRepository(prisma);

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
