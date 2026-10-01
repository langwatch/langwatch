/**
 * The activity feed reads this repository under a weaker permission than
 * trace content needs. `TriggerSent` carries the `traceId` that fired,
 * but the mapped view must not, or a viewer who can't read traces gets one.
 */
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { describe, expect, it } from "vitest";

import { PrismaTriggerFireHistoryRepository } from "../prisma.trigger-fire-history.repository.ts";

const STORED_ROW = {
  id: "fire_1",
  projectId: "project_1",
  triggerId: "trigger_1",
  traceId: "trace_secret_1",
  customGraphId: null,
  createdAt: new Date("2026-09-01T10:00:00.000Z"),
  resolvedAt: null,
};

function databaseHolding(rows: (typeof STORED_ROW)[]) {
  const queries: unknown[] = [];

  return {
    queries,
    database: {
      triggerSent: {
        findMany: async (args: unknown) => {
          queries.push(args);
          return rows;
        },
      },
    },
  };
}

describe("PrismaTriggerFireHistoryRepository", () => {
  describe("given stored fires that each name the trace that matched", () => {
    describe("when the activity feed reads them", () => {
      /** @scenario "History never exposes trace content" */
      it("returns what fired and when, and never the trace id", async () => {
        const { database } = databaseHolding([STORED_ROW]);
        const repository = PrismaTriggerFireHistoryRepository.create(prismaDouble(database));

        const forProject = await repository.findAllRecentForProject({
          projectId: "project_1",
          limit: 10,
        });
        const forTrigger = await repository.findAllRecentByTriggerId({
          projectId: "project_1",
          triggerId: "trigger_1",
          limit: 10,
        });

        for (const fires of [forProject, forTrigger]) {
          expect(fires).toEqual([
            {
              id: "fire_1",
              triggerId: "trigger_1",
              customGraphId: null,
              createdAt: STORED_ROW.createdAt,
              resolvedAt: null,
            },
          ]);
          expect(JSON.stringify(fires)).not.toContain("trace_secret_1");
          expect(fires[0]).not.toHaveProperty("traceId");
        }
      });

      /** @scenario "History never exposes trace content" */
      it("scopes every read to the project asking", async () => {
        const { database, queries } = databaseHolding([STORED_ROW]);
        const repository = PrismaTriggerFireHistoryRepository.create(prismaDouble(database));

        await repository.findAllRecentForProject({ projectId: "project_1", limit: 10 });

        expect(queries[0]).toMatchObject({ where: { projectId: "project_1" } });
      });
    });
  });
});
