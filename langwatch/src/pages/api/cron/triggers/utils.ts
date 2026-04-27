import { prisma } from "~/server/db";
import type { Trace } from "~/server/tracer/types";
import type { TraceGroups, TriggerData } from "./types";

export const updateAlert = async (
  triggerId: string,
  updatedAt: number,
  projectId: string,
) => {
  await prisma.trigger.update({
    where: { id: triggerId, projectId },
    data: { lastRunAt: updatedAt },
  });
};

export const addTriggersSent = async (
  triggerId: string,
  triggerData: TriggerData[],
) => {
  // Separate trace-based and custom graph alerts
  const traceData = triggerData.filter((data) => data.traceId);
  const customGraphData = triggerData.filter(
    (data) => data.graphId && !data.traceId,
  );

  // Create TriggerSent records for trace-based triggers
  if (traceData.length > 0) {
    await prisma.triggerSent.createMany({
      data: traceData.map((data) => ({
        triggerId: triggerId,
        traceId: data.traceId!,
        customGraphId: null,
        projectId: data.projectId,
      })),
      skipDuplicates: true,
    });
  }

  // Create TriggerSent record for custom graph alerts (one per fire)
  if (customGraphData.length > 0) {
    await prisma.triggerSent.create({
      data: {
        triggerId: triggerId,
        traceId: null, // No traceId for custom graph alerts
        customGraphId: customGraphData[0]!.graphId!, // Set customGraphId for custom graph alerts
        projectId: customGraphData[0]!.projectId,
        resolvedAt: null, // New alert is unresolved
      },
    });
  }
};

/**
 * Fetches TriggerSent records for the given traceIds, chunking the query
 * to avoid massive IN clauses that exhaust RDS CPU.
 *
 * @see https://github.com/langwatch/langwatch/issues/2597
 */
export const triggerSentForMany = async (
  triggerId: string,
  traceIds: string[],
  projectId: string,
) => {
  if (traceIds.length === 0) {
    return [];
  }

  const CHUNK_SIZE = 500;
  const results: Awaited<ReturnType<typeof prisma.triggerSent.findMany>> = [];

  for (let i = 0; i < traceIds.length; i += CHUNK_SIZE) {
    const chunk = traceIds.slice(i, i + CHUNK_SIZE);
    const triggerSent = await prisma.triggerSent.findMany({
      where: {
        triggerId,
        traceId: { in: chunk },
        projectId,
      },
    });
    results.push(...triggerSent);
  }

  return results;
};

export const getLatestUpdatedAt = (traces: TraceGroups): number | undefined => {
  const updatedTimes = traces.groups
    .flatMap((group: Trace[]) =>
      group
        .map((item: Trace) => item.timestamps?.updated_at)
        .filter((timestamp): timestamp is number => timestamp !== undefined),
    )
    .sort((a: number, b: number) => b - a);

  return updatedTimes[0];
};

export const checkThreshold = (
  value: number,
  threshold: number,
  operator: string,
): boolean => {
  switch (operator) {
    case "gt":
      return value > threshold;
    case "lt":
      return value < threshold;
    case "gte":
      return value >= threshold;
    case "lte":
      return value <= threshold;
    case "eq":
      return Math.abs(value - threshold) < 0.0001; // Floating point comparison
    default:
      return false;
  }
};
