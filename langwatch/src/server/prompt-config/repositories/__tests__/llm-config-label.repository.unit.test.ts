import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  PromptVersionLabelRepository,
  LabelValidationError,
} from "../llm-config-label.repository";

function makeMockPrisma(overrides: Record<string, unknown> = {}) {
  return {
    promptVersionLabel: {
      upsert: vi.fn(),
      findFirst: vi.fn(),
    },
    llmPromptConfigVersion: {
      findFirst: vi.fn(),
    },
    ...overrides,
  } as unknown as PrismaClient;
}

describe("PromptVersionLabelRepository", () => {
  describe("validateLabel()", () => {
    describe("when label is 'production'", () => {
      it("does not throw", () => {
        const repo = new PromptVersionLabelRepository(makeMockPrisma());

        expect(() => repo.validateLabel("production")).not.toThrow();
      });
    });

    describe("when label is 'staging'", () => {
      it("does not throw", () => {
        const repo = new PromptVersionLabelRepository(makeMockPrisma());

        expect(() => repo.validateLabel("staging")).not.toThrow();
      });
    });

    describe("when label is 'canary'", () => {
      it("throws a validation error", () => {
        const repo = new PromptVersionLabelRepository(makeMockPrisma());

        expect(() => repo.validateLabel("canary")).toThrow(
          expect.objectContaining({
            name: "LabelValidationError",
            message: expect.stringContaining(
              'Only "production" and "staging" are allowed',
            ),
          }),
        );
      });
    });

    describe("when label is 'latest'", () => {
      it("throws a validation error", () => {
        const repo = new PromptVersionLabelRepository(makeMockPrisma());

        expect(() => repo.validateLabel("latest")).toThrow(
          LabelValidationError,
        );
      });
    });

    describe("when label is an arbitrary string", () => {
      it("throws a validation error", () => {
        const repo = new PromptVersionLabelRepository(makeMockPrisma());

        expect(() => repo.validateLabel("custom-release")).toThrow(
          LabelValidationError,
        );
      });
    });
  });

  describe("assignLabel()", () => {
    describe("when version does not belong to the prompt", () => {
      it("throws a validation error", async () => {
        const prisma = makeMockPrisma();
        (
          prisma.llmPromptConfigVersion.findFirst as ReturnType<typeof vi.fn>
        ).mockResolvedValue(null);
        const repo = new PromptVersionLabelRepository(prisma);

        await expect(
          repo.assignLabel({
            configId: "config-1",
            versionId: "version-from-other-prompt",
            label: "production",
            projectId: "project-1",
          }),
        ).rejects.toThrow(
          expect.objectContaining({
            name: "LabelValidationError",
            message: expect.stringContaining(
              "Version does not belong to this prompt config",
            ),
          }),
        );
      });
    });

    describe("when label is invalid", () => {
      it("throws a validation error without hitting the database", async () => {
        const prisma = makeMockPrisma();
        const repo = new PromptVersionLabelRepository(prisma);

        await expect(
          repo.assignLabel({
            configId: "config-1",
            versionId: "v1",
            label: "canary",
            projectId: "project-1",
          }),
        ).rejects.toThrow(LabelValidationError);

        expect(
          prisma.llmPromptConfigVersion.findFirst,
        ).not.toHaveBeenCalled();
      });
    });

    describe("when label and version are valid", () => {
      it("calls upsert with correct parameters", async () => {
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

        const result = await repo.assignLabel({
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
});
