import { describe, it, expect, vi } from "vitest";
import { AgentRepository } from "../agent.repository";
import type { PrismaClient } from "@prisma/client";

function makeMockPrisma(findFirstResult: unknown = null) {
  return {
    agent: {
      findFirst: vi.fn(() => Promise.resolve(findFirstResult)),
    },
  } as unknown as PrismaClient;
}

describe("AgentRepository", () => {
  describe("exists()", () => {
    describe("when agent exists and is not archived", () => {
      it("returns true", async () => {
        const prisma = makeMockPrisma({ id: "agent_1" });
        const repository = new AgentRepository(prisma);

        const result = await repository.exists({ id: "agent_1", projectId: "proj_1" });

        expect(result).toBe(true);
      });

      it("queries with archivedAt: null", async () => {
        const prisma = makeMockPrisma({ id: "agent_1" });
        const repository = new AgentRepository(prisma);

        await repository.exists({ id: "agent_1", projectId: "proj_1" });

        expect(prisma.agent.findFirst).toHaveBeenCalledWith({
          where: { id: "agent_1", projectId: "proj_1", archivedAt: null },
          select: { id: true },
        });
      });
    });

    describe("when agent does not exist", () => {
      it("returns false", async () => {
        const prisma = makeMockPrisma(null);
        const repository = new AgentRepository(prisma);

        const result = await repository.exists({ id: "agent_missing", projectId: "proj_1" });

        expect(result).toBe(false);
      });
    });
  });
});
