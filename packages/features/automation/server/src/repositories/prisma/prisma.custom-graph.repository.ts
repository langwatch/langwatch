import type { CustomGraph, CustomGraphNameRef } from "@langwatch/automation-contract";
import { CustomGraphRepository } from "../custom-graph.repository";
import type { AutomationDatabase } from "../../ports/automation-database.port";

const BUILDER_CHART_KIND = "builder";

export class PrismaCustomGraphRepository extends CustomGraphRepository {
  private constructor(private readonly database: AutomationDatabase) {
    super();
  }

  static create(database: AutomationDatabase): PrismaCustomGraphRepository {
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

  async existsInProject(input: {
    customGraphId: string;
    projectId: string;
  }): Promise<boolean> {
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
