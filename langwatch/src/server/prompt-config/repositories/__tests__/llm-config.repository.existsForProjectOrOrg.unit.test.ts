import { describe, it, expect, vi } from "vitest";
import { LlmConfigRepository } from "../llm-config.repository";
import type { PrismaClient } from "@prisma/client";

function makeMockPrisma(findFirstResult: unknown = null) {
  return {
    llmPromptConfig: {
      findFirst: vi.fn(() => Promise.resolve(findFirstResult)),
    },
  } as unknown as PrismaClient;
}

describe("LlmConfigRepository", () => {
  describe("existsForProjectOrOrg()", () => {
    describe("when prompt exists in same project", () => {
      it("returns true", async () => {
        const prisma = makeMockPrisma({ id: "prompt_1" });
        const repository = new LlmConfigRepository(prisma);

        const result = await repository.existsForProjectOrOrg({
          id: "prompt_1",
          projectId: "proj_1",
          organizationId: "org_1",
        });

        expect(result).toBe(true);
      });
    });

    describe("when prompt is org-scoped", () => {
      it("queries with OR pattern including org scope", async () => {
        const prisma = makeMockPrisma({ id: "prompt_org" });
        const repository = new LlmConfigRepository(prisma);

        await repository.existsForProjectOrOrg({
          id: "prompt_org",
          projectId: "proj_1",
          organizationId: "org_1",
        });

        expect(prisma.llmPromptConfig.findFirst).toHaveBeenCalledWith({
          where: {
            id: "prompt_org",
            deletedAt: null,
            OR: [
              { projectId: "proj_1" },
              { organizationId: "org_1", scope: "ORGANIZATION" },
            ],
          },
          select: { id: true },
        });
      });

      it("returns true", async () => {
        const prisma = makeMockPrisma({ id: "prompt_org" });
        const repository = new LlmConfigRepository(prisma);

        const result = await repository.existsForProjectOrOrg({
          id: "prompt_org",
          projectId: "proj_1",
          organizationId: "org_1",
        });

        expect(result).toBe(true);
      });
    });

    describe("when prompt does not exist", () => {
      it("returns false", async () => {
        const prisma = makeMockPrisma(null);
        const repository = new LlmConfigRepository(prisma);

        const result = await repository.existsForProjectOrOrg({
          id: "prompt_missing",
          projectId: "proj_1",
          organizationId: "org_1",
        });

        expect(result).toBe(false);
      });
    });

    describe("when prompt is soft-deleted", () => {
      it("returns false", async () => {
        // findFirst returns null because deletedAt filter excludes it
        const prisma = makeMockPrisma(null);
        const repository = new LlmConfigRepository(prisma);

        const result = await repository.existsForProjectOrOrg({
          id: "prompt_deleted",
          projectId: "proj_1",
          organizationId: "org_1",
        });

        expect(result).toBe(false);
      });

      it("queries with deletedAt: null to exclude soft-deleted prompts", async () => {
        const prisma = makeMockPrisma(null);
        const repository = new LlmConfigRepository(prisma);

        await repository.existsForProjectOrOrg({
          id: "prompt_deleted",
          projectId: "proj_1",
          organizationId: "org_1",
        });

        expect(prisma.llmPromptConfig.findFirst).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({ deletedAt: null }),
          }),
        );
      });
    });

    describe("when prompt belongs to a different organization", () => {
      it("returns false", async () => {
        // The mock returns null because the query filters by organizationId: "org_A"
        // but the prompt belongs to org_B
        const prisma = makeMockPrisma(null);
        const repository = new LlmConfigRepository(prisma);

        const result = await repository.existsForProjectOrOrg({
          id: "prompt_org_b",
          projectId: "proj_a",
          organizationId: "org_A",
        });

        expect(result).toBe(false);
        expect(prisma.llmPromptConfig.findFirst).toHaveBeenCalledWith({
          where: {
            id: "prompt_org_b",
            deletedAt: null,
            OR: [
              { projectId: "proj_a" },
              { organizationId: "org_A", scope: "ORGANIZATION" },
            ],
          },
          select: { id: true },
        });
      });
    });
  });
});
