import type { CustomGraph, PrismaClient } from "~/generated/prisma/client";
import { BUILDER_CHART_KIND } from "~/server/analytics/chartKinds";
import type {
  AutomationCustomGraphRepository,
  CustomGraphNameRef,
} from "./custom-graph.repository";

/**
 * Automations over the chart builder's charts.
 *
 * Every predicate carries {@link BUILDER_CHART_KIND}: an automation evaluates a
 * chart by reading its series out of the `graph` payload, which a saved
 * workbench chart's `{ sql, parameters, vegaLiteSpec }` definition does not
 * have. Scoping the reads is what makes such a chart unreachable from here
 * rather than reachable and silently seriesless.
 */
export class PrismaAutomationCustomGraphRepository
  implements AutomationCustomGraphRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  async findById({
    customGraphId,
    projectId,
  }: {
    customGraphId: string;
    projectId: string;
  }): Promise<CustomGraph | null> {
    return this.prisma.customGraph.findUnique({
      where: { id: customGraphId, projectId, kind: BUILDER_CHART_KIND },
    });
  }

  async existsInProject({
    customGraphId,
    projectId,
  }: {
    customGraphId: string;
    projectId: string;
  }): Promise<boolean> {
    const row = await this.prisma.customGraph.findUnique({
      where: { id: customGraphId, projectId, kind: BUILDER_CHART_KIND },
      select: { id: true },
    });
    return row !== null;
  }

  async findAllNamesByIds({
    customGraphIds,
    projectId,
  }: {
    customGraphIds: string[];
    projectId: string;
  }): Promise<CustomGraphNameRef[]> {
    return this.prisma.customGraph.findMany({
      where: {
        id: { in: customGraphIds },
        projectId,
        kind: BUILDER_CHART_KIND,
      },
      select: { id: true, name: true },
    });
  }
}
