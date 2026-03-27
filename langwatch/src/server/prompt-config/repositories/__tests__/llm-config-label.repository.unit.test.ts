import { describe, it, expect, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  LlmConfigLabelRepository,
  LabelValidationError,
  LabelConflictError,
} from "../llm-config-label.repository";

function makeMockPrisma(overrides: Record<string, unknown> = {}) {
  return {
    llmPromptConfigLabel: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      createMany: vi.fn(),
    },
    llmPromptConfigVersion: {
      findFirst: vi.fn(),
    },
    ...overrides,
  } as unknown as PrismaClient;
}

describe("LlmConfigLabelRepository", () => {
  describe("validateLabelName()", () => {
    describe("when label name is empty", () => {
      it("throws a validation error", () => {
        const repo = new LlmConfigLabelRepository(makeMockPrisma());

        expect(() => repo.validateLabelName("")).toThrow(LabelValidationError);
        expect(() => repo.validateLabelName("")).toThrow(
          "Label name must be a non-empty string",
        );
      });
    });

    describe("when label name is only whitespace", () => {
      it("throws a validation error", () => {
        const repo = new LlmConfigLabelRepository(makeMockPrisma());

        expect(() => repo.validateLabelName("   ")).toThrow(
          LabelValidationError,
        );
      });
    });

    describe('when label name is "latest"', () => {
      it("throws a validation error", () => {
        const repo = new LlmConfigLabelRepository(makeMockPrisma());

        expect(() => repo.validateLabelName("latest")).toThrow(
          LabelValidationError,
        );
        expect(() => repo.validateLabelName("latest")).toThrow(
          '"latest" is a reserved label',
        );
      });
    });

    describe("when label name contains uppercase characters", () => {
      it("throws a validation error", () => {
        const repo = new LlmConfigLabelRepository(makeMockPrisma());

        expect(() => repo.validateLabelName("Production")).toThrow(
          LabelValidationError,
        );
      });
    });

    describe("when label name is valid", () => {
      it("does not throw for simple names", () => {
        const repo = new LlmConfigLabelRepository(makeMockPrisma());

        expect(() => repo.validateLabelName("production")).not.toThrow();
        expect(() => repo.validateLabelName("staging")).not.toThrow();
        expect(() => repo.validateLabelName("canary")).not.toThrow();
        expect(() => repo.validateLabelName("v2-release")).not.toThrow();
        expect(() =>
          repo.validateLabelName("my_custom_label"),
        ).not.toThrow();
      });
    });
  });

  describe("create()", () => {
    describe("when version does not belong to the prompt", () => {
      it("throws a validation error", async () => {
        const prisma = makeMockPrisma();
        (
          prisma.llmPromptConfigVersion.findFirst as ReturnType<typeof vi.fn>
        ).mockResolvedValue(null);
        const repo = new LlmConfigLabelRepository(prisma);

        await expect(
          repo.create({
            configId: "config-1",
            name: "production",
            versionId: "version-from-other-prompt",
            projectId: "project-1",
          }),
        ).rejects.toThrow(LabelValidationError);
        await expect(
          repo.create({
            configId: "config-1",
            name: "production",
            versionId: "version-from-other-prompt",
            projectId: "project-1",
          }),
        ).rejects.toThrow("Version does not belong to this prompt config");
      });
    });

    describe("when label already exists for the prompt", () => {
      it("throws a conflict error", async () => {
        const prisma = makeMockPrisma();
        (
          prisma.llmPromptConfigVersion.findFirst as ReturnType<typeof vi.fn>
        ).mockResolvedValue({ id: "v1", configId: "config-1" });
        (
          prisma.llmPromptConfigLabel.create as ReturnType<typeof vi.fn>
        ).mockRejectedValue(
          new Prisma.PrismaClientKnownRequestError(
            "Unique constraint failed on the fields: (`configId`,`name`,`projectId`)",
            { code: "P2002", clientVersion: "5.0.0" },
          ),
        );
        const repo = new LlmConfigLabelRepository(prisma);

        await expect(
          repo.create({
            configId: "config-1",
            name: "production",
            versionId: "v1",
            projectId: "project-1",
          }),
        ).rejects.toThrow(LabelConflictError);
      });
    });
  });
});
