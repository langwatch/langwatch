import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  PromptVersionLabelRepository,
  TagValidationError,
} from "../llm-config-tag.repository";

function makeMockPrisma(overrides: Record<string, unknown> = {}) {
  return {
    promptVersionLabel: {
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

describe("PromptVersionLabelRepository", () => {
  describe("validateTag()", () => {
    describe("when tag is 'production'", () => {
      it("does not throw", () => {
        const repo = new PromptVersionLabelRepository(makeMockPrisma());

        expect(() => repo.validateTag("production")).not.toThrow();
      });
    });

    describe("when tag is 'staging'", () => {
      it("does not throw", () => {
        const repo = new PromptVersionLabelRepository(makeMockPrisma());

        expect(() => repo.validateTag("staging")).not.toThrow();
      });
    });

    describe("when tag is 'canary'", () => {
      it("throws a validation error", () => {
        const repo = new PromptVersionLabelRepository(makeMockPrisma());

        expect(() => repo.validateTag("canary")).toThrow(
          expect.objectContaining({
            name: "TagValidationError",
            message: expect.stringContaining('Invalid label "canary"'),
          }),
        );
      });
    });

    describe("when tag is 'latest'", () => {
      it("throws a validation error", () => {
        const repo = new PromptVersionLabelRepository(makeMockPrisma());

        expect(() => repo.validateTag("latest")).toThrow(
          TagValidationError,
        );
      });
    });

    describe("when tag is an arbitrary string", () => {
      it("throws a validation error", () => {
        const repo = new PromptVersionLabelRepository(makeMockPrisma());

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
        const repo = new PromptVersionLabelRepository(prisma);

        await expect(
          repo.assignTag({
            configId: "config-1",
            versionId: "version-from-other-prompt",
            label: "production",
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
        const repo = new PromptVersionLabelRepository(prisma);

        await expect(
          repo.assignTag({
            configId: "config-1",
            versionId: "v1",
            label: "canary",
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
        const mockLabel = {
          id: "label_abc",
          configId: "config-1",
          versionId: "v1",
          label: "production",
          projectId: "project-1",
        };
        (
          prisma.promptVersionLabel.upsert as ReturnType<typeof vi.fn>
        ).mockResolvedValue(mockLabel);
        const repo = new PromptVersionLabelRepository(prisma);

        const result = await repo.assignTag({
          configId: "config-1",
          versionId: "v1",
          label: "production",
          projectId: "project-1",
          userId: "user-1",
        });

        expect(result).toEqual(mockLabel);
        expect(prisma.promptVersionLabel.upsert).toHaveBeenCalledWith({
          where: {
            projectId: "project-1",
            configId_label: { configId: "config-1", label: "production" },
          },
          create: expect.objectContaining({
            configId: "config-1",
            versionId: "v1",
            label: "production",
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
          prisma.promptVersionLabel.findMany as ReturnType<typeof vi.fn>
        ).mockResolvedValue([]);
        const repo = new PromptVersionLabelRepository(prisma);

        const result = await repo.getTagsForConfig({
          configId: "config-1",
          projectId: "project-1",
        });

        expect(result).toEqual([]);
        expect(prisma.promptVersionLabel.findMany).toHaveBeenCalledWith({
          where: { configId: "config-1", projectId: "project-1" },
        });
      });
    });

    describe("when tags are assigned", () => {
      it("returns all tags for the config", async () => {
        const prisma = makeMockPrisma();
        const mockLabels = [
          {
            id: "label_1",
            configId: "config-1",
            versionId: "v2",
            label: "production",
            projectId: "project-1",
          },
          {
            id: "label_2",
            configId: "config-1",
            versionId: "v3",
            label: "staging",
            projectId: "project-1",
          },
        ];
        (
          prisma.promptVersionLabel.findMany as ReturnType<typeof vi.fn>
        ).mockResolvedValue(mockLabels);
        const repo = new PromptVersionLabelRepository(prisma);

        const result = await repo.getTagsForConfig({
          configId: "config-1",
          projectId: "project-1",
        });

        expect(result).toEqual(mockLabels);
        expect(result).toHaveLength(2);
      });
    });
  });
});
