import { prisma } from "~/server/db";
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
  // Only create TriggerSent records for actual traces (not custom graphs)
  const traceData = triggerData.filter((data) => data.traceId);

  if (traceData.length === 0) {
    return;
  }

  await prisma.triggerSent.createMany({
    data: traceData.map((data) => ({
      triggerId: triggerId,
      traceId: data.traceId!,
      projectId: data.projectId,
    })),
    skipDuplicates: true,
  });
};

export const triggerSentForMany = async (
  triggerId: string,
  traceIds: string[],
  projectId: string,
) => {
  const triggerSent = await prisma.triggerSent.findMany({
    where: {
      triggerId,
      traceId: { in: traceIds },
      projectId,
    },
  });
  return triggerSent;
};

export const getLatestUpdatedAt = (traces: TraceGroups) => {
  const updatedTimes = traces.groups
    .flatMap((group: any) =>
      group.map((item: any) => item.timestamps.updated_at),
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
