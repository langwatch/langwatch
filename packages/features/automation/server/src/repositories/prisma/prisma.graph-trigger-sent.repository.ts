import type { PrismaClient } from "@langwatch/prisma-client/generated";
import {
  GraphTriggerSentRepository,
  type OpenGraphTriggerSent,
} from "../graph-trigger-sent.repository";
import { parseSeriesIndex } from "@langwatch/automation-contract";

/** Prisma-backed graph-alert incident ledger, private to Automation server. */
export class PrismaGraphTriggerSentRepository extends GraphTriggerSentRepository {
  private constructor(private readonly database: PrismaClient) {
    super();
  }

  static graphAlertIncidentKey({ triggerId }: { triggerId: string }): string {
    return `graph-alert:${triggerId}`;
  }

  static create(database: object): PrismaGraphTriggerSentRepository {
    return new PrismaGraphTriggerSentRepository(database as PrismaClient);
  }

  async findProjectsWithGraphTriggers(): Promise<string[]> {
    const projectIds = await this.projectIds();
    if (projectIds.length === 0) return [];
    const rows = await this.database.trigger.findMany({
      where: {
        projectId: { in: projectIds },
        active: true,
        deleted: false,
        customGraphId: { not: null },
      },
      select: { projectId: true },
      distinct: ["projectId"],
    });
    return uniqueStrings(rows, "projectId");
  }

  async findProjectsWithOpenGraphTriggerSent(): Promise<Set<string>> {
    const projectIds = await this.projectIds();
    if (projectIds.length === 0) return new Set();
    const rows = await this.database.triggerSent.findMany({
      where: {
        projectId: { in: projectIds },
        resolvedAt: null,
        customGraphId: { not: null },
      },
      select: { projectId: true },
      distinct: ["projectId"],
    });
    return new Set(uniqueStrings(rows, "projectId"));
  }

  private async projectIds(): Promise<string[]> {
    const rows = await this.database.project.findMany({ select: { id: true } });
    return uniqueStrings(rows, "id");
  }

  async tryFindGraphTriggerSource(input: {
    triggerId: string;
    customGraphId: string;
    projectId: string;
    seriesName?: string;
  }): Promise<"trace" | "evaluation" | undefined> {
    const row = await this.database.customGraph.findUnique({
      where: {
        id: input.customGraphId,
        projectId: input.projectId,
        kind: "builder",
      },
      select: { graph: true },
    });
    if (!row || typeof row !== "object") return undefined;
    const graph = (row as { graph?: unknown }).graph;
    const series =
      typeof graph === "object" &&
      graph !== null &&
      "series" in graph &&
      Array.isArray(graph.series)
        ? graph.series
        : [];
    const index = parseSeriesIndex(input.seriesName);
    const metric =
      Number.isInteger(index) &&
      index >= 0 &&
      typeof series[index] === "object" &&
      series[index] !== null &&
      "metric" in series[index]
        ? series[index].metric
        : undefined;
    return typeof metric === "string" ? metricSource(metric) : undefined;
  }

  async findOpenTriggerIdsForProject(projectId: string): Promise<Set<string>> {
    const rows = await this.database.triggerSent.findMany({
      where: { projectId, resolvedAt: null, customGraphId: { not: null } },
      select: { triggerId: true },
      distinct: ["triggerId"],
    });
    return new Set(
      rows.flatMap((row: unknown) =>
        typeof row === "object" &&
        row !== null &&
        "triggerId" in row &&
        typeof row.triggerId === "string"
          ? [row.triggerId]
          : [],
      ),
    );
  }

  async tryFindOpenForGraphAlert(input: {
    triggerId: string;
    projectId: string;
    customGraphId: string;
  }): Promise<OpenGraphTriggerSent | null> {
    const row = await this.database.triggerSent.findFirst({
      where: { ...input, resolvedAt: null },
      orderBy: { createdAt: "desc" },
      select: { id: true, triggerId: true, projectId: true, customGraphId: true },
    });
    return toOpenRow(row);
  }

  async tryFindLatestForGraphAlert(input: {
    triggerId: string;
    projectId: string;
    customGraphId: string;
  }): Promise<{ id: string } | null> {
    return (await this.database.triggerSent.findFirst({
      where: input,
      orderBy: { createdAt: "desc" },
      select: { id: true },
    })) as { id: string } | null;
  }

  async tryClaimOpenForGraphAlert(input: {
    triggerId: string;
    projectId: string;
    customGraphId: string;
  }): Promise<OpenGraphTriggerSent | null> {
    try {
      const row = await this.database.triggerSent.create({
        data: {
          ...input,
          traceId: null,
          resolvedAt: null,
          openIncidentKey: PrismaGraphTriggerSentRepository.graphAlertIncidentKey({
            triggerId: input.triggerId,
          }),
        },
        select: { id: true, triggerId: true, projectId: true, customGraphId: true },
      });
      return toOpenRow(row);
    } catch (error) {
      if ((error as { code?: unknown })?.code === "P2002") return null;
      throw error;
    }
  }

  async deleteOpenClaim(input: { id: string; projectId: string }): Promise<void> {
    await this.database.triggerSent.delete({ where: input });
  }

  async markResolvedById(input: { id: string; projectId: string; now: Date }): Promise<void> {
    await this.database.triggerSent.update({
      where: { id: input.id, projectId: input.projectId },
      data: { resolvedAt: input.now, openIncidentKey: null },
    });
  }
}

function toOpenRow(row: unknown): OpenGraphTriggerSent | null {
  if (typeof row !== "object" || row === null) return null;
  const value = row as Partial<OpenGraphTriggerSent>;
  if (
    typeof value.id !== "string" ||
    typeof value.triggerId !== "string" ||
    typeof value.projectId !== "string" ||
    typeof value.customGraphId !== "string"
  ) {
    return null;
  }
  return {
    id: value.id,
    triggerId: value.triggerId,
    projectId: value.projectId,
    customGraphId: value.customGraphId,
  };
}

function uniqueStrings(rows: unknown[], key: string): string[] {
  return [
    ...new Set(
      rows.flatMap((row: unknown) => {
        if (typeof row !== "object" || row === null) return [];
        const value = (row as Record<string, unknown>)[key];
        return typeof value === "string" ? [value] : [];
      }),
    ),
  ];
}

function metricSource(metric: string): "trace" | "evaluation" | undefined {
  if (metric.startsWith("evaluations.")) return "evaluation";
  if (
    metric.startsWith("metadata.") ||
    metric.startsWith("performance.") ||
    metric.startsWith("events.") ||
    metric.startsWith("sentiment.") ||
    metric.startsWith("threads.") ||
    metric.startsWith("topics.") ||
    metric.startsWith("traces.")
  )
    return "trace";
  return undefined;
}
