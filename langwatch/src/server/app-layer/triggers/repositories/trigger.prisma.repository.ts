import type { PrismaClient } from "@prisma/client";
import {
  NOTIFICATION_CADENCES,
  type NotificationCadence,
} from "~/automations/cadences";
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
        notificationCadence: true,
        traceDebounceMs: true,
      },
    });

    return triggers.map((t) => ({
      ...t,
      actionParams: t.actionParams ?? {},
      filters: parseFilters(t.filters),
      notificationCadence: parseCadence(t.notificationCadence),
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

  async isSendClaimed({
    triggerId,
    traceId,
    projectId,
  }: {
    triggerId: string;
    traceId: string;
    projectId: string;
  }): Promise<boolean> {
    const existing = await this.prisma.triggerSent.findFirst({
      where: { triggerId, traceId, projectId },
      select: { id: true },
    });
    return existing !== null;
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

// Defensive narrow: column is a free-form TEXT so an upstream write of an
// unknown value (e.g. a future cadence not yet shipped) must not throw —
// fall back to "immediate" so the trigger keeps firing.
function parseCadence(raw: string): NotificationCadence {
  return (NOTIFICATION_CADENCES as readonly string[]).includes(raw)
    ? (raw as NotificationCadence)
    : "immediate";
}
