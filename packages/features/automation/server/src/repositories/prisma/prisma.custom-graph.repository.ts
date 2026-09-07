import type { CustomGraph, CustomGraphNameRef } from "@langwatch/automation-contract";
import { CustomGraphRepository } from "../custom-graph.repository.ts";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

const BUILDER_CHART_KIND = "builder";

/**
 * Only what this repository touches, so composition names the slice it needs
 * rather than the whole generated client.
 */
export type CustomGraphDatabase = Pick<PrismaClient, "customGraph">;

export class PrismaCustomGraphRepository extends CustomGraphRepository {
  private constructor(private readonly database: CustomGraphDatabase) {
    super();
  }

  static create(database: CustomGraphDatabase): PrismaCustomGraphRepository {
    return new PrismaCustomGraphRepository(database);
  }

  async tryFindById(input: {
    customGraphId: string;
    projectId: string;
  }): Promise<CustomGraph | null> {
    return (await this.database.customGraph.findUnique({
      where: {
        id: input.customGraphId,
        projectId: input.projectId,
        kind: BUILDER_CHART_KIND,
      },
    })) as CustomGraph | null;
  }

  async existsInProject(input: { customGraphId: string; projectId: string }): Promise<boolean> {
    const row = await this.database.customGraph.findUnique({
      where: {
        id: input.customGraphId,
        projectId: input.projectId,
        kind: BUILDER_CHART_KIND,
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
      },
      select: { id: true, name: true },
    })) as CustomGraphNameRef[];
  }
}
