import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { PrismaTriggerFireHistoryRepository } from "../repositories/trigger-fire-history.prisma.repository";

function makeRepo() {
  const findMany = vi.fn().mockResolvedValue([]);
  const prisma = {
    triggerSent: { findMany },
  } as unknown as PrismaClient;
  return {
    repo: new PrismaTriggerFireHistoryRepository(prisma),
    findMany,
  };
}

describe("PrismaTriggerFireHistoryRepository", () => {
  describe("findAllRecentByTriggerId", () => {
    describe("when reading a trigger's recent fires", () => {
      it("scopes the query to the project, trigger, and requested limit", async () => {
        const { repo, findMany } = makeRepo();

        await repo.findAllRecentByTriggerId({
          projectId: "proj_123",
          triggerId: "trigger_1",
          limit: 20,
        });

        expect(findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { projectId: "proj_123", triggerId: "trigger_1" },
            orderBy: { createdAt: "desc" },
            take: 20,
          }),
        );
      });

      it("selects fire metadata only, never traceId or captured trace content", async () => {
        const { repo, findMany } = makeRepo();

        await repo.findAllRecentByTriggerId({
          projectId: "proj_123",
          triggerId: "trigger_1",
          limit: 20,
        });

        // The prisma `select` is the real guard behind `triggers:view`: it
        // must never widen into a side door around the trace protections
        // surface, so the projected columns are pinned exactly here.
        const selectArg = findMany.mock.calls[0]![0].select;
        expect(Object.keys(selectArg).sort()).toEqual([
          "createdAt",
          "customGraphId",
          "id",
          "resolvedAt",
          "triggerId",
        ]);
        expect(selectArg).not.toHaveProperty("traceId");
      });
    });
  });
});
