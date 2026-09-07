import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";
import { PrismaTriggerFireHistoryRepository } from "../repositories/trigger-fire-history.prisma.repository";

function makeRepo() {
  const findMany = vi.fn().mockResolvedValue([]);
  const findFirst = vi.fn().mockResolvedValue(null);
  const prisma = {
    triggerSent: { findMany, findFirst },
  } as unknown as PrismaClient;
  return {
    repo: new PrismaTriggerFireHistoryRepository(prisma),
    findMany,
    findFirst,
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

  describe("findLatestByTriggerId", () => {
    describe("when reading a trigger's newest fire", () => {
      /** @scenario "The newest fire is asked for by project and trigger, newest first, one row" */
      it("asks for exactly one row, newest first, scoped to project and trigger", async () => {
        const { repo, findFirst } = makeRepo();

        await repo.findLatestByTriggerId({
          projectId: "proj_123",
          triggerId: "trigger_1",
        });

        // This is the shape `TriggerSent_projectId_triggerId_createdAt_idx`
        // exists for: equality on the leading two columns, ordered by the
        // third. Changing the where or the orderBy here silently turns the
        // health probe back into a scan of every row the trigger ever wrote.
        expect(findFirst).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { projectId: "proj_123", triggerId: "trigger_1" },
            orderBy: { createdAt: "desc" },
          }),
        );
      });

      /** @scenario "The newest fire carries metadata only" */
      it("selects fire metadata only, never traceId or captured trace content", async () => {
        const { repo, findFirst } = makeRepo();

        await repo.findLatestByTriggerId({
          projectId: "proj_123",
          triggerId: "trigger_1",
        });

        const selectArg = findFirst.mock.calls[0]![0].select;
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
