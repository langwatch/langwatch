/**
 * @vitest-environment node
 * The scope filter on automation's graph reads: every query leaves out a graph on an Only me
 * board, and the tenancy guard every process composes its client with admits each one.
 * Spec: modules/dashboard/specs/dashboards-v2.feature AC187.
 */
import { PrismaTenancyGuardService } from "@langwatch/prisma-client";
import { describe, expect, it } from "vitest";

import { PrismaCustomGraphRepository } from "../prisma.custom-graph.repository.ts";
import { PrismaGraphTriggerSentRepository } from "../prisma.graph-trigger-sent.repository.ts";

type CustomGraphDatabase = Parameters<typeof PrismaCustomGraphRepository.create>[0];
type GraphTriggerSentDatabase = Parameters<typeof PrismaGraphTriggerSentRepository.create>[0];

const NOT_ON_AN_ONLY_ME_BOARD = {
  OR: [{ dashboardId: null }, { dashboard: { scope: { not: "PRIVATE" } } }],
};
const IN_PROJECT = { projectId: "project-1", kind: "builder" };

type Query = { action: string; where: unknown };

/** A `customGraph` table that records each query after the real tenancy guard has passed it. */
function guardedGraphs(): { queries: Query[]; customGraph: CustomGraphDatabase["customGraph"] } {
  const guard = PrismaTenancyGuardService.create();
  const queries: Query[] = [];
  const read = (action: string, found: unknown) => async (args: { where: unknown }) => {
    await guard.execute({ model: "CustomGraph", action, args }, async () => found);
    queries.push({ action, where: args.where });
    return found;
  };

  return {
    queries,
    customGraph: {
      findUnique: read("findUnique", null),
      findMany: read("findMany", []),
    } as never,
  };
}

describe("given automation's reads of builder graphs", () => {
  describe("when a graph is read by its id", () => {
    /** @scenario "AC187 Scope: an alert or a scheduled report reads nothing from an Only me board" */
    it("leaves out a graph on an Only me board from the row and from the existence check", async () => {
      const { queries, customGraph } = guardedGraphs();
      const repository = PrismaCustomGraphRepository.create({ customGraph });
      const ask = { customGraphId: "graph-1", projectId: "project-1" };

      await repository.findById(ask);
      await repository.existsInProject(ask);

      const where = { id: "graph-1", ...IN_PROJECT, ...NOT_ON_AN_ONLY_ME_BOARD };
      expect(queries).toEqual([
        { action: "findUnique", where },
        { action: "findUnique", where },
      ]);
    });

    /** @scenario "AC187 Scope: an alert or a scheduled report reads nothing from an Only me board" */
    it("leaves it out of the metric source an alert's heartbeat reads", async () => {
      const { queries, customGraph } = guardedGraphs();
      const repository = PrismaGraphTriggerSentRepository.create({
        customGraph,
      } as GraphTriggerSentDatabase);

      const source = await repository.findGraphTriggerSource({
        triggerId: "trigger-1",
        customGraphId: "graph-1",
        projectId: "project-1",
        seriesName: "0/metadata.trace_id/cardinality",
      });

      expect({ source, queries }).toEqual({
        source: undefined,
        queries: [
          {
            action: "findUnique",
            where: { id: "graph-1", ...IN_PROJECT, ...NOT_ON_AN_ONLY_ME_BOARD },
          },
        ],
      });
    });
  });

  describe("when graphs are read by board or by a list of ids", () => {
    /** @scenario "AC187 Scope: an alert or a scheduled report reads nothing from an Only me board" */
    it("leaves out the graphs of an Only me board from a report's panels and from the names", async () => {
      const { queries, customGraph } = guardedGraphs();
      const repository = PrismaCustomGraphRepository.create({ customGraph });

      await repository.findAllByDashboardId({ dashboardId: "board-1", projectId: "project-1" });
      await repository.findAllNamesByIds({ customGraphIds: ["graph-1"], projectId: "project-1" });

      expect(queries).toEqual([
        {
          action: "findMany",
          where: { dashboardId: "board-1", ...IN_PROJECT, ...NOT_ON_AN_ONLY_ME_BOARD },
        },
        {
          action: "findMany",
          where: { id: { in: ["graph-1"] }, ...IN_PROJECT, ...NOT_ON_AN_ONLY_ME_BOARD },
        },
      ]);
    });
  });
});
