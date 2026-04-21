import type { PrismaClient } from "@prisma/client";
import type { TriggerFilters } from "~/server/filters/types";
import type {
  TriggerRepository,
  TriggerSummary,
} from "./trigger.repository";

export class PrismaTriggerRepository implements TriggerRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findActiveForProject(projectId: string): Promise<TriggerSummary[]> {
    const triggers = await this.prisma.trigger.findMany({
      where: { projectId, active: true, deleted: false },
      select: {
        id: true,
        projectId: true,
        name: true,
        action: true,
        actionParams: true,
        filters: true,
        alertType: true,
        message: true,
        customGraphId: true,
      },
    });

    return triggers.map((t) => ({
      ...t,
      actionParams: t.actionParams ?? {},
      filters: parseFilters(t.filters),
    }));
  }

  async hasSentForTrace(
    triggerId: string,
    traceId: string,
  ): Promise<boolean> {
    const record = await this.prisma.triggerSent.findFirst({
      where: { triggerId, traceId },
      select: { id: true },
    });
    return record !== null;
  }

  async recordSent({
    triggerId,
    traceId,
    projectId,
  }: {
    triggerId: string;
    traceId: string;
    projectId: string;
  }): Promise<void> {
    await this.prisma.triggerSent.createMany({
      data: [{ triggerId, traceId, projectId }],
      skipDuplicates: true,
    });
  }

  async updateLastRunAt(
    triggerId: string,
    projectId: string,
  ): Promise<void> {
    await this.prisma.trigger.update({
      where: { id: triggerId, projectId },
      data: { lastRunAt: Date.now() },
    });
  }
}

function parseFilters(raw: unknown): TriggerFilters {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as TriggerFilters;
    } catch {
      return {};
    }
  }
  if (raw && typeof raw === "object") {
    return raw as TriggerFilters;
  }
  return {};
}
