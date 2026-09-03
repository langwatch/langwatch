// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The match engine's calendar entries (ADR-128 §12).
 *
 * Registering a scheduler HANDLER is only half the wiring — something has to
 * mint the `ScheduledJob` rows that make the loop fire it, or the registration
 * is unreachable code with a targetType no row in the fleet carries. Same shape
 * as the cost rollup comparator's reconciler next door, and the same house
 * precedents behind both (`reconcileReportSchedules`,
 * `reconcileIngestionPullProcesses`): walk the targets at worker boot, create
 * what is missing, safe on every pod, never resurrect what an operator switched
 * off.
 *
 * ADR-128 §12 asks for a job that runs "when its inputs change, never per page
 * view". The load-bearing half of that sentence is the second one, and a
 * calendar entry satisfies it completely. The first half wants a hook on the
 * write that discovers a person — and nothing writes `DiscoveredPerson` yet, so
 * there is no write to hook. `IdentityMatchSuggestionService.recompute` is the
 * whole of what such a hook would call, so wiring one later is a call site
 * rather than a redesign.
 *
 * Boot reconciliation only, for the reason the comparator gives: nobody SAVES a
 * matcher. Its target is the hidden governance project, created lazily from
 * half a dozen call sites, and threading a scheduler dependency through all of
 * them buys a newly-onboarded tenant its first pass a few hours earlier.
 *
 * Spec: specs/governance/governance-identity-match-engine.feature
 */

import type { PrismaClient } from "~/generated/prisma/client";
import { computeNextRunAt } from "~/server/app-layer/scheduler/nextRunAt";
import type { ScheduledJobRepository } from "~/server/app-layer/scheduler/scheduler.types";

import { PROJECT_KIND } from "./governanceProject.service";

/** The scheduler's key for this consumer. */
export const IDENTITY_MATCH_TARGET_TYPE = "governanceIdentityMatch";

/**
 * Nightly, after the day's pulls have landed so a person discovered today is
 * matched tonight rather than tomorrow night.
 *
 * Off the hour and off the comparator's slot: every scheduled job in the world
 * is written `0 <h>`, and two governance jobs sharing an instant would put both
 * organizations' passes on one event loop at once.
 */
export const IDENTITY_MATCH_CRON = "41 5 * * *";

/**
 * UTC, not the organization's timezone. Nothing here is bucketed by day, so a
 * local calendar would only add a reason for two deployments to disagree about
 * when the queue was last refreshed.
 */
export const IDENTITY_MATCH_TIMEZONE = "UTC";

/**
 * One tenant's existing entry, or null when the read itself failed.
 *
 * A read that throws leaves every tenant behind this one unscheduled until the
 * next boot — the exact failure the per-tenant write catches exist to prevent,
 * so the read is inside the boundary too.
 */
async function findEntry({
  scheduledJobs,
  tenantId,
  logger,
}: {
  scheduledJobs: ScheduledJobRepository;
  tenantId: string;
  logger: { warn: (context: unknown, message: string) => void };
}) {
  try {
    return await scheduledJobs.findAllForProject({
      projectId: tenantId,
      targetType: IDENTITY_MATCH_TARGET_TYPE,
    });
  } catch (error) {
    logger.warn(
      {
        tenantId,
        error: error instanceof Error ? error.message : String(error),
      },
      "Reading the identity match schedule for this tenant failed; the next boot retries it",
    );
    return null;
  }
}

/**
 * One tenant's missing entry, created.
 *
 * Create-if-missing: an entry that already exists is left exactly as it is,
 * INCLUDING an inactive one, so an operator who paused a pass does not have it
 * switched back on by the next deploy. Safe on every pod — `upsertForTarget` is
 * race-hardened on the unique.
 *
 * A failure is logged and counted rather than thrown, so one bad tenant cannot
 * stop the rest of the fleet from being scheduled.
 */
async function ensureEntryForTenant({
  scheduledJobs,
  tenantId,
  logger,
}: {
  scheduledJobs: ScheduledJobRepository;
  tenantId: string;
  logger: { warn: (context: unknown, message: string) => void };
}): Promise<{ created: number; failed: number }> {
  const existing = await findEntry({ scheduledJobs, tenantId, logger });
  // One unreadable tenant, counted and stepped over.
  if (existing === null) return { created: 0, failed: 1 };
  if (existing.length > 0) return { created: 0, failed: 0 };

  try {
    await scheduledJobs.upsertForTarget({
      projectId: tenantId,
      targetType: IDENTITY_MATCH_TARGET_TYPE,
      targetId: tenantId,
      cron: IDENTITY_MATCH_CRON,
      timezone: IDENTITY_MATCH_TIMEZONE,
      nextRunAt: computeNextRunAt({
        cron: IDENTITY_MATCH_CRON,
        timezone: IDENTITY_MATCH_TIMEZONE,
        after: new Date(),
      }),
    });
    return { created: 1, failed: 0 };
  } catch (error) {
    // The aggregate count alone strands an operator: name the tenant and the
    // reason so a nonzero `failed` is actionable.
    logger.warn(
      {
        tenantId,
        error: error instanceof Error ? error.message : String(error),
      },
      "Scheduling the identity matcher for this tenant failed; the next boot retries it",
    );
    return { created: 0, failed: 1 };
  }
}

/**
 * One archived tenant's live entries, switched off.
 *
 * Only what is actually there and still active, so the count reports work done
 * rather than no-op writes against tenants that never had an entry.
 */
async function deactivateEntriesForTenant({
  scheduledJobs,
  tenantId,
  logger,
}: {
  scheduledJobs: ScheduledJobRepository;
  tenantId: string;
  logger: { warn: (context: unknown, message: string) => void };
}): Promise<{ deactivated: number; failed: number }> {
  const existing = await findEntry({ scheduledJobs, tenantId, logger });
  if (existing === null) return { deactivated: 0, failed: 1 };

  let deactivated = 0;
  let failed = 0;
  for (const job of existing.filter((row) => row.active)) {
    try {
      await scheduledJobs.deactivateForTarget({
        projectId: tenantId,
        targetType: IDENTITY_MATCH_TARGET_TYPE,
        targetId: job.targetId,
      });
      deactivated += 1;
    } catch (error) {
      failed += 1;
      logger.warn(
        {
          tenantId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Switching off the identity matcher for this archived tenant failed; the next boot retries it",
      );
    }
  }
  return { deactivated, failed };
}

/**
 * Give every live governance project a nightly matcher entry, and switch the
 * entry off for projects that have been archived — a matcher running against a
 * dead tenant rewrites a review queue nobody can reach.
 *
 * Create-if-missing: an entry that already exists is left exactly as it is,
 * INCLUDING an inactive one, so an operator who paused a pass does not have it
 * switched back on by the next deploy.
 */
export async function reconcileIdentityMatchSchedules({
  prisma,
  scheduledJobs,
  logger,
}: {
  prisma: PrismaClient;
  scheduledJobs: ScheduledJobRepository;
  logger: { warn: (context: unknown, message: string) => void };
}): Promise<{ created: number; deactivated: number; failed: number }> {
  const [live, archived] = await Promise.all([
    prisma.project.findMany({
      where: { kind: PROJECT_KIND.INTERNAL_GOVERNANCE, archivedAt: null },
      select: { id: true },
    }),
    prisma.project.findMany({
      where: {
        kind: PROJECT_KIND.INTERNAL_GOVERNANCE,
        archivedAt: { not: null },
      },
      select: { id: true },
    }),
  ]);

  let created = 0;
  let deactivated = 0;
  let failed = 0;

  for (const project of live) {
    const result = await ensureEntryForTenant({
      scheduledJobs,
      tenantId: project.id,
      logger,
    });
    created += result.created;
    failed += result.failed;
  }

  for (const project of archived) {
    const result = await deactivateEntriesForTenant({
      scheduledJobs,
      tenantId: project.id,
      logger,
    });
    deactivated += result.deactivated;
    failed += result.failed;
  }

  return { created, deactivated, failed };
}
