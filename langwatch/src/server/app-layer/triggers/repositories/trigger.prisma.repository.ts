import type { PrismaClient } from "@prisma/client";
import {
  NOTIFICATION_CADENCES,
  type NotificationCadence,
} from "~/automations/cadences";
import type { TriggerFilters } from "~/server/filters/types";
import type {
  GraphTriggerSentRepository,
  OpenGraphTriggerSent,
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
        slackTemplateType: true,
        slackTemplate: true,
        emailSubjectTemplate: true,
        emailBodyTemplate: true,
      },
    });

    return triggers.map(
      ({
        slackTemplateType,
        slackTemplate,
        emailSubjectTemplate,
        emailBodyTemplate,
        ...t
      }) => ({
        ...t,
        actionParams: t.actionParams ?? {},
        filters: parseFilters(t.filters),
        notificationCadence: parseCadence(t.notificationCadence),
        templates: {
          slackTemplateType: slackTemplateType ?? null,
          slackTemplate: slackTemplate ?? null,
          emailSubjectTemplate: emailSubjectTemplate ?? null,
          emailBodyTemplate: emailBodyTemplate ?? null,
        },
      }),
    );
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

  async updateLastRunAt(triggerId: string, projectId: string): Promise<void> {
    await this.prisma.trigger.update({
      where: { id: triggerId, projectId },
      data: { lastRunAt: Date.now() },
    });
  }
}

/**
 * Prisma-backed mirror of the cron's graph-alert TriggerSent dedup
 * pattern (ADR-034 Phase 5). The cron's flow is the source of truth:
 *
 *  - findFirst(triggerId, projectId, customGraphId, resolvedAt: null,
 *    orderBy createdAt desc) — `unresolvedTriggerSent`
 *    (customGraphTrigger.ts:179-189)
 *  - create({ triggerId, traceId: null, customGraphId, projectId,
 *    resolvedAt: null }) — `addTriggersSent`
 *    (utils.ts:39-48)
 *  - update({ where: { id, projectId }, data: { resolvedAt: new Date() } })
 *    (customGraphTrigger.ts:264-271)
 *
 * The event-sourced handler MUST mirror this byte-for-byte so the same
 * "still firing?" semantics hold whether the cron fired the alert or
 * the new path did, including operators flipping the flag mid-flight.
 */
export class PrismaGraphTriggerSentRepository
  implements GraphTriggerSentRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  async findOpenForGraphAlert({
    triggerId,
    projectId,
    customGraphId,
  }: {
    triggerId: string;
    projectId: string;
    customGraphId: string;
  }): Promise<OpenGraphTriggerSent | null> {
    const row = await this.prisma.triggerSent.findFirst({
      where: { triggerId, projectId, customGraphId, resolvedAt: null },
      orderBy: { createdAt: "desc" },
      select: { id: true, triggerId: true, projectId: true, customGraphId: true },
    });
    if (!row || row.customGraphId == null) return null;
    return {
      id: row.id,
      triggerId: row.triggerId,
      projectId: row.projectId,
      customGraphId: row.customGraphId,
    };
  }

  async createOpenForGraphAlert({
    triggerId,
    projectId,
    customGraphId,
  }: {
    triggerId: string;
    projectId: string;
    customGraphId: string;
  }): Promise<OpenGraphTriggerSent> {
    const row = await this.prisma.triggerSent.create({
      data: {
        triggerId,
        traceId: null,
        customGraphId,
        projectId,
        resolvedAt: null,
      },
      select: { id: true, triggerId: true, projectId: true, customGraphId: true },
    });
    return {
      id: row.id,
      triggerId: row.triggerId,
      projectId: row.projectId,
      customGraphId: customGraphId,
    };
  }

  async markResolvedById({
    id,
    projectId,
    now,
  }: {
    id: string;
    projectId: string;
    now: Date;
  }): Promise<void> {
    await this.prisma.triggerSent.update({
      where: { id, projectId },
      data: { resolvedAt: now },
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
