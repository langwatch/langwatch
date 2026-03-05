import { describe, it, expect, vi, beforeEach } from "vitest";
import { LlmConfigRepository } from "../llm-config.repository";
import type { PrismaClient } from "@prisma/client";

function makeMockPrisma(overrides: Record<string, unknown> = {}) {
  return {
    llmPromptConfig: {
      findFirst: vi.fn(() => Promise.resolve(null)),
      findMany: vi.fn(() => Promise.resolve([])),
      update: vi.fn(() => Promise.resolve({})),
      delete: vi.fn(() => Promise.resolve({})),
      ...overrides,
    },
    project: {
      findUnique: vi.fn(() =>
        Promise.resolve({
          id: "proj_1",
          team: { organization: { id: "org_1" }, organizationId: "org_1" },
        }),
      ),
    },
  } as unknown as PrismaClient;
}

describe("LlmConfigRepository", () => {
  describe("deleteConfig()", () => {
    describe("when prompt exists and belongs to the project", () => {
      it("soft-deletes by setting deletedAt instead of hard-deleting", async () => {
        const mockUpdate = vi.fn(() =>
          Promise.resolve({ id: "prompt_1", deletedAt: new Date() }),
        );
        const prisma = makeMockPrisma({ update: mockUpdate });

        // Mock getConfigByIdOrHandleWithLatestVersion to return a config
        const repo = new LlmConfigRepository(prisma);
        vi.spyOn(repo, "getConfigByIdOrHandleWithLatestVersion").mockResolvedValue({
          id: "prompt_1",
          projectId: "proj_1",
          organizationId: "org_1",
          name: "Support Bot",
          handle: "support-bot",
          scope: "PROJECT",
          copiedFromPromptId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
          latestVersion: {} as any,
        });

        await repo.deleteConfig("prompt_1", "proj_1", "org_1");

        expect(mockUpdate).toHaveBeenCalledWith({
          where: { id: "prompt_1", projectId: "proj_1" },
          data: { deletedAt: expect.any(Date) },
        });
      });

      it("does not call prisma.delete", async () => {
        const mockDelete = vi.fn();
        const mockUpdate = vi.fn(() => Promise.resolve({}));
        const prisma = makeMockPrisma({ delete: mockDelete, update: mockUpdate });

        const repo = new LlmConfigRepository(prisma);
        vi.spyOn(repo, "getConfigByIdOrHandleWithLatestVersion").mockResolvedValue({
          id: "prompt_1",
          projectId: "proj_1",
          organizationId: "org_1",
          name: "Support Bot",
          handle: "support-bot",
          scope: "PROJECT",
          copiedFromPromptId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
          latestVersion: {} as any,
        });

        await repo.deleteConfig("prompt_1", "proj_1", "org_1");

        expect(mockDelete).not.toHaveBeenCalled();
      });
    });
  });

  describe("getAllWithLatestVersion()", () => {
    describe("when soft-deleted prompts exist", () => {
      it("filters out soft-deleted prompts via deletedAt: null", async () => {
        const mockFindMany = vi.fn(() => Promise.resolve([]));
        const prisma = makeMockPrisma({ findMany: mockFindMany });

        const repo = new LlmConfigRepository(prisma);
        await repo.getAllWithLatestVersion({
          projectId: "proj_1",
          organizationId: "org_1",
        });

        expect(mockFindMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              deletedAt: null,
            }),
          }),
        );
      });
    });
  });
});
