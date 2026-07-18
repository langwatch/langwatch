import { Prisma, type PrismaClient } from "@prisma/client";
import {
  NOTIFICATION_CADENCES,
  type NotificationCadence,
} from "~/shared/automations/cadences";
import type { TriggerFilters } from "~/server/filters/types";
import {
  graphAlertIncidentKey,
  type GraphTriggerSentRepository,
  type OpenGraphTriggerSent,
  type ReportScheduleTarget,
  type TriggerRepository,
  type TriggerSummary,
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
        triggerKind: true,
        actionParams: true,
        filters: true,
        filterQuery: true,
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

  async findActiveReportTargets(): Promise<ReportScheduleTarget[]> {
    // Cross-tenant sweep (one scheduler serves every project), so it opts out of
    // the multitenancy guard via the sanctioned `-- @tenancy:` marker — like the
    // scheduler's own due-scan. Only id/projectId/actionParams are needed: the
    // caller re-derives the cron/timezone from actionParams and writes back only
    // project-scoped ScheduledJob rows. `triggerKind` is an enum column; Postgres
    // casts the 'REPORT' text literal to it. `actionParams` is jsonb — Prisma
    // returns it already parsed.
    return this.prisma.$queryRaw<ReportScheduleTarget[]>`
      SELECT "id", "projectId", "actionParams"
      FROM "Trigger"
      WHERE "triggerKind" = 'REPORT' AND "active" = true AND "deleted" = false
      -- @tenancy: report-schedule reconciliation cross-tenant sweep (worker boot)
    `;
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
 * pattern (ADR-034 Phase 5), hardened with an atomic pre-send claim
 * (ADR-034 P1). The cron's flow is the source of truth for the dedup shape:
 *
 *  - findFirst(triggerId, projectId, customGraphId, resolvedAt: null,
 *    orderBy createdAt desc) — `unresolvedTriggerSent`
 *    (customGraphTrigger.ts:179-189) — kept as the cheap pre-check.
 *  - create({ triggerId, traceId: null, customGraphId, projectId,
 *    resolvedAt: null }) — `addTriggersSent` (utils.ts:39-48) — now carries
 *    `openIncidentKey` and runs BEFORE the send, so its unique violation is the
 *    real race guard rather than a post-hoc record.
 *  - update({ where: { id, projectId }, data: { resolvedAt, openIncidentKey:
 *    null } }) (customGraphTrigger.ts:264-271) — resolve frees the identity.
 *
 * The event-sourced handler MUST mirror the "still firing?" semantics so they
 * hold whether the cron fired the alert or the new path did, including
 * operators flipping the flag mid-flight.
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
      select: {
        id: true,
        triggerId: true,
        projectId: true,
        customGraphId: true,
      },
    });
    if (!row || row.customGraphId == null) return null;
    return {
      id: row.id,
      triggerId: row.triggerId,
      projectId: row.projectId,
      customGraphId: row.customGraphId,
    };
  }

  async findLatestForGraphAlert({
    triggerId,
    projectId,
    customGraphId,
  }: {
    triggerId: string;
    projectId: string;
    customGraphId: string;
  }): Promise<{ id: string } | null> {
    // Deliberately NOT filtered on `resolvedAt` — the caller wants the latest
    // incident whether it is still open or long resolved, because the id is
    // used as the alert's fire generation, not as its firing state.
    const row = await this.prisma.triggerSent.findFirst({
      where: { triggerId, projectId, customGraphId },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    return row ? { id: row.id } : null;
  }

  async claimOpenForGraphAlert({
    triggerId,
    projectId,
    customGraphId,
  }: {
    triggerId: string;
    projectId: string;
    customGraphId: string;
  }): Promise<OpenGraphTriggerSent | null> {
    try {
      const row = await this.prisma.triggerSent.create({
        data: {
          triggerId,
          traceId: null,
          customGraphId,
          projectId,
          resolvedAt: null,
          // The atomic claim: the single-column unique on this key means the
          // FIRST concurrent evaluator inserts and the rest hit P2002 below.
          openIncidentKey: graphAlertIncidentKey({ triggerId }),
        },
        select: {
          id: true,
          triggerId: true,
          projectId: true,
          customGraphId: true,
        },
      });
      return {
        id: row.id,
        triggerId: row.triggerId,
        projectId: row.projectId,
        customGraphId: customGraphId,
      };
    } catch (error) {
      // Another evaluator already holds this alert's open incident. Swallow the
      // PRECISE unique-violation only — the loser backs off without dispatching.
      // Anything else is a real failure and must propagate.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        return null;
      }
      throw error;
    }
  }

  async deleteOpenClaim({
    id,
    projectId,
  }: {
    id: string;
    projectId: string;
  }): Promise<void> {
    await this.prisma.triggerSent.delete({
      where: { id, projectId },
    });
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
      // Clear openIncidentKey alongside resolvedAt: the identity MUST free up
      // (go NULL) for the alert to fire again, or the next claim's INSERT hits
      // the still-held unique key.
      data: { resolvedAt: now, openIncidentKey: null },
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
