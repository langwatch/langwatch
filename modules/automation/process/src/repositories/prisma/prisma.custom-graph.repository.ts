import type { CustomGraph, CustomGraphNameRef } from "@langwatch/automation-contract";
import type { Prisma, PrismaClient } from "@langwatch/prisma-client/generated";

import { CustomGraphRepository } from "../custom-graph.repository.ts";

const BUILDER_CHART_KIND = "builder";

/**
 * Automation runs with no member identity, so a graph placed on an Only me board is not there
 * for it: the answer a project credential gets (dashboards-v2.feature AC171). A teammate could
 * otherwise attach a report or an alert to such a graph and be sent its title and its chart.
 */
export const GRAPH_AUTOMATION_REACHES = {
  OR: [{ dashboardId: null }, { dashboard: { scope: { not: "PRIVATE" } } }],
} satisfies Prisma.CustomGraphWhereInput;

/**
 * Only what this repository touches, so composition names the slice it needs
 * rather than the whole generated client.
 */
type CustomGraphDatabase = Pick<PrismaClient, "customGraph">;

export class PrismaCustomGraphRepository extends CustomGraphRepository {
  private constructor(private readonly database: CustomGraphDatabase) {
    super();
  }

  static create(database: CustomGraphDatabase): PrismaCustomGraphRepository {
    return new PrismaCustomGraphRepository(database);
  }

  async findById(input: { customGraphId: string; projectId: string }): Promise<CustomGraph | null> {
    return (await this.database.customGraph.findUnique({
      where: {
        id: input.customGraphId,
        projectId: input.projectId,
        kind: BUILDER_CHART_KIND,
        ...GRAPH_AUTOMATION_REACHES,
      },
    })) as CustomGraph | null;
  }

  async existsInProject(input: { customGraphId: string; projectId: string }): Promise<boolean> {
    const row = await this.database.customGraph.findUnique({
      where: {
        id: input.customGraphId,
        projectId: input.projectId,
        kind: BUILDER_CHART_KIND,
        ...GRAPH_AUTOMATION_REACHES,
      },
      select: { id: true },
    });
    return row !== null;
  }

  async findAllByDashboardId(input: {
    dashboardId: string;
    projectId: string;
  }): Promise<CustomGraph[]> {
    return (await this.database.customGraph.findMany({
      where: {
        dashboardId: input.dashboardId,
        projectId: input.projectId,
        kind: BUILDER_CHART_KIND,
        ...GRAPH_AUTOMATION_REACHES,
      },
      orderBy: [{ gridRow: "asc" }, { gridColumn: "asc" }],
    })) as CustomGraph[];
  }

  async findAllNamesByIds(input: {
    customGraphIds: string[];
    projectId: string;
  }): Promise<CustomGraphNameRef[]> {
    return (await this.database.customGraph.findMany({
      where: {
        id: { in: input.customGraphIds },
        projectId: input.projectId,
        kind: BUILDER_CHART_KIND,
        ...GRAPH_AUTOMATION_REACHES,
      },
      select: { id: true, name: true },
    })) as CustomGraphNameRef[];
  }
}
