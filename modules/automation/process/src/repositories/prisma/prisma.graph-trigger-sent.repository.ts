import { parseSeriesIndex } from "@langwatch/automation-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { toDate, type Instant } from "@langwatch/time";

import {
  GraphTriggerSentRepository,
  type OpenGraphTriggerSent,
} from "../graph-trigger-sent.repository.ts";

/** Prisma-backed graph-alert incident ledger, private to Automation server. */
/**
 * Only what this repository touches, so composition names the slice it needs
 * rather than the whole generated client.
 */
export type GraphTriggerSentDatabase = Pick<
  PrismaClient,
  "customGraph" | "project" | "trigger" | "triggerSent"
>;

export class PrismaGraphTriggerSentRepository extends GraphTriggerSentRepository {
  private constructor(private readonly database: GraphTriggerSentDatabase) {
    super();
  }

  static graphAlertIncidentKey({ triggerId }: { triggerId: string }): string {
    return `graph-alert:${triggerId}`;
  }

  static create(database: GraphTriggerSentDatabase): PrismaGraphTriggerSentRepository {
    return new PrismaGraphTriggerSentRepository(database);
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

  async findGraphTriggerSource(input: {
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
    const entry: unknown = series[index];
    const indexInRange = Number.isInteger(index) && index >= 0;
    const entryHasMetric = typeof entry === "object" && entry !== null && "metric" in entry;
    const metric = indexInRange && entryHasMetric ? entry.metric : undefined;
    return typeof metric === "string" ? findMetricSource(metric) : undefined;
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

  async findOpenForGraphAlert(input: {
    triggerId: string;
    projectId: string;
    customGraphId: string;
  }): Promise<OpenGraphTriggerSent | null> {
    const row = await this.database.triggerSent.findFirst({
      where: { ...input, resolvedAt: null },
      orderBy: { createdAt: "desc" },
      select: { id: true, triggerId: true, projectId: true, customGraphId: true },
    });
    return findOpenRow(row);
  }

  async findLatestForGraphAlert(input: {
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

  async claimOpenForGraphAlert(input: {
    triggerId: string;
    projectId: string;
    customGraphId: string;
  }): Promise<OpenGraphTriggerSent | "already-claimed"> {
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
      const claimed = findOpenRow(row);
      if (!claimed) {
        throw new Error("Graph-alert claim row failed to parse after a successful create");
      }
      return claimed;
    } catch (error) {
      if ((error as { code?: unknown })?.code === "P2002") return "already-claimed";
      throw error;
    }
  }

  async deleteOpenClaim(input: { id: string; projectId: string }): Promise<void> {
    await this.database.triggerSent.delete({ where: input });
  }

  async markResolvedById(input: { id: string; projectId: string; now: Instant }): Promise<void> {
    await this.database.triggerSent.update({
      where: { id: input.id, projectId: input.projectId },
      data: { resolvedAt: toDate(input.now), openIncidentKey: null },
    });
  }
}

function findOpenRow(row: unknown): OpenGraphTriggerSent | null {
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

function findMetricSource(metric: string): "trace" | "evaluation" | undefined {
  if (metric.startsWith("evaluations.")) return "evaluation";
  const traceMetricPrefixes = [
    "metadata.",
    "performance.",
    "events.",
    "sentiment.",
    "threads.",
    "topics.",
    "traces.",
  ];
  if (traceMetricPrefixes.some((prefix) => metric.startsWith(prefix))) return "trace";
  return undefined;
}
