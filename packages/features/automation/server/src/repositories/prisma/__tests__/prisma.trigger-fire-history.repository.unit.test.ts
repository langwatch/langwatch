/**
 * The automations activity feed reads this repository, and the feed is gated
 * by a weaker permission than trace content is. A row in `TriggerSent` carries
 * the `traceId` that made the automation fire; the mapped view must not, or
 * the list hands a trace identifier to a viewer who may not read traces.
 */
import { describe, expect, it } from "vitest";
import { PrismaTriggerFireHistoryRepository } from "../prisma.trigger-fire-history.repository";

const STORED_ROW = {
  id: "fire_1",
  projectId: "project_1",
  triggerId: "trigger_1",
  traceId: "trace_secret_1",
  customGraphId: null,
  createdAt: new Date("2026-09-01T10:00:00.000Z"),
  resolvedAt: null,
};

function databaseHolding(rows: Array<typeof STORED_ROW>) {
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
        const repository = PrismaTriggerFireHistoryRepository.create(database);

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
        const repository = PrismaTriggerFireHistoryRepository.create(database);

        await repository.findAllRecentForProject({ projectId: "project_1", limit: 10 });

        expect(queries[0]).toMatchObject({ where: { projectId: "project_1" } });
      });
    });
  });
});
