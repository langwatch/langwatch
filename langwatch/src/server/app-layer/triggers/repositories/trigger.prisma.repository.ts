import type { PrismaClient, Trigger } from "@prisma/client";
import type { TriggerFilters } from "~/server/filters/types";
import type {
  TriggerRepository,
  TriggerSummary,
  TriggerUpsertInput,
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

  async claimSend({
    triggerId,
    traceId,
    projectId,
  }: {
    triggerId: string;
    traceId: string;
    projectId: string;
  }): Promise<boolean> {
    // Atomic claim: relies on the @@unique([triggerId, traceId]) constraint
    // on TriggerSent. createMany returns the number of rows actually inserted,
    // so a concurrent dispatcher loses cleanly with count: 0.
    const result = await this.prisma.triggerSent.createMany({
      data: [{ triggerId, traceId, projectId }],
      skipDuplicates: true,
    });
    return result.count === 1;
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

  async create({
    id,
    projectId,
    data,
  }: {
    id: string;
    projectId: string;
    data: TriggerUpsertInput;
  }): Promise<Trigger> {
    return this.prisma.trigger.create({
      data: {
        id,
        projectId,
        lastRunAt: Date.now(),
        ...data,
      },
    });
  }

  async update({
    triggerId,
    projectId,
    data,
  }: {
    triggerId: string;
    projectId: string;
    data: TriggerUpsertInput;
  }): Promise<Trigger> {
    return this.prisma.trigger.update({
      where: { id: triggerId, projectId },
      data,
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
