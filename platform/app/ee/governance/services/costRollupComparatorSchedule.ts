// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The comparator's calendar entries (ADR-128 wave 1).
 *
 * Registering a scheduler HANDLER is only half the wiring — something has to
 * mint the `ScheduledJob` rows that make the loop fire it. Without this module
 * the comparator's registration in presets.ts was unreachable code: the
 * targetType existed, and no row in the fleet ever carried it.
 *
 * Shape follows the two house precedents, which agree with each other:
 * `TriggerService.reconcileReportSchedules` (ADR-044) and
 * `reconcileIngestionPullProcesses`. Both walk their targets at worker boot,
 * create what is missing, are safe to run on every pod, and never resurrect
 * something an operator turned off.
 *
 * Boot reconciliation ONLY, deliberately — no write-path hook. The precedents
 * pair a reconciler with a mint on the user's write, because a user who saves
 * a report expects it to run tonight. Nobody saves a comparator: its target is
 * the governance project itself, which is created lazily from half a dozen
 * call sites, and threading a scheduler dependency through all of them would
 * be a large change to buy very little. What it buys is small because the
 * comparator samples YESTERDAY: a tenant onboarded between two boots has no
 * yesterday worth checking, so waiting for the next boot costs nothing real.
 */

import type { PrismaClient } from "~/generated/prisma/client";
import { computeNextRunAt } from "~/server/app-layer/scheduler/nextRunAt";
import type {
  ScheduledJobRecord,
  ScheduledJobRepository,
} from "~/server/app-layer/scheduler/scheduler.types";

import {
  GOVERNANCE_COST_SOURCE,
  type GovernanceCostSource,
} from "../projections/governanceCostRollup.constants";
import { PROJECT_KIND } from "./governanceProject.service";

/**
 * Just after midnight UTC, so the day being sampled is closed before anything
 * asks whether its summary is right. Off the hour because every scheduled job
 * in the world is written `0 <h>`, and a fleet that all fires on :00 makes its
 * own thundering herd.
 */
export const COST_ROLLUP_COMPARATOR_CRON = "23 4 * * *";

/**
 * UTC, and not the org's timezone. The rollup buckets days in UTC, so a
 * comparator running on a local calendar would sample a day the table does not
 * have and report drift that is purely a timezone difference.
 */
export const COST_ROLLUP_COMPARATOR_TIMEZONE = "UTC";

/**
 * The lanes that get their own entry: the pulled lane, for every tenant.
 *
 * The metered lane is not compared. The cost screen reads it straight off the
 * per-request ledger, and the rollup fold no longer writes gateway cells, so
 * a gateway comparison would re-derive cells the summary is never written
 * with and always find nothing on both sides — a check that could not fail.
 *
 * Exported as a tuple so the comparator's event-type map can be typed by it:
 * the compiler then proves the map covers exactly the lanes that get an
 * entry, no more and no fewer.
 */
export const COMPARED_COST_SOURCES = [GOVERNANCE_COST_SOURCE.PULLED] as const;
export type ComparedCostSource = (typeof COMPARED_COST_SOURCES)[number];

/**
 * The lanes older builds scheduled and this one no longer compares. An
 * ACTIVE entry for one of these is switched off at boot and never recreated;
 * an inactive one is left exactly as it is, retired rather than deleted so an
 * operator can still see what the older build had scheduled.
 */
const RETIRED_COST_SOURCES: readonly GovernanceCostSource[] = [
  GOVERNANCE_COST_SOURCE.GATEWAY,
];

function isRetiredTargetId(targetId: string): boolean {
  return RETIRED_COST_SOURCES.some((costSource) =>
    targetId.endsWith(`:${costSource}`),
  );
}

/**
 * The scheduler's target identity for one tenant's lane.
 *
 * The tenant has to be IN here. `ScheduledJob` carries
 * `@@unique([targetType, targetId])` — unique across the whole fleet, not per
 * project — so a bare `"gateway"` would let exactly one organization own a
 * gateway comparator. Worse, it would fail silently: `upsertForTarget` scopes
 * its update by projectId, finds nothing, falls through to create, and
 * swallows the resulting P2002 as a benign race. Every tenant after the first
 * would simply have no entry and nothing would say so.
 */
export function costRollupComparatorTargetId({
  tenantId,
  costSource,
}: {
  tenantId: string;
  costSource: GovernanceCostSource;
}): string {
  return `${tenantId}:${costSource}`;
}

/**
 * The lane a fired entry is about, or null if the row names one we do not
 * have.
 *
 * Read back by suffix rather than by splitting: a project id is opaque and a
 * future one containing a colon must not shift which lane the row means. Null
 * rather than a guess, because the caller comparing the wrong lane would
 * report drift between two things that were never meant to match.
 */
export function costSourceFromTargetId(
  targetId: string,
): ComparedCostSource | null {
  return (
    COMPARED_COST_SOURCES.find((costSource) =>
      targetId.endsWith(`:${costSource}`),
    ) ?? null
  );
}

/**
 * One tenant's existing entries, or null when the read itself failed.
 *
 * The read is the other half of the per-tenant boundary. Both callers below
 * catch their writes, but an unguarded read throws straight out of the pass
 * and every tenant after this one goes unscheduled until the next boot — the
 * exact failure the write-level catches exist to prevent.
 */
async function findEntriesForTenant({
  scheduledJobs,
  targetType,
  tenantId,
  logger,
}: {
  scheduledJobs: ScheduledJobRepository;
  targetType: string;
  tenantId: string;
  logger: { warn: (context: unknown, message: string) => void };
}): Promise<ScheduledJobRecord[] | null> {
  try {
    // One query per tenant, so a tenant already scheduled costs no writes.
    return await scheduledJobs.findAllForProject({
      projectId: tenantId,
      targetType,
    });
  } catch (error) {
    logger.warn(
      {
        tenantId,
        error: error instanceof Error ? error.message : String(error),
      },
      "Reading the cost rollup comparator entries for this tenant failed; the next boot retries it",
    );
    return null;
  }
}

/**
 * One tenant's missing entries created, and its retired ones switched off.
 *
 * Create-if-missing, like the report reconciler: an entry that already exists
 * is left exactly as it is, INCLUDING an inactive one, because an operator who
 * paused a noisy comparator must not have it switched back on by the next
 * deploy. Safe on every pod — `upsertForTarget` is race-hardened on the
 * unique.
 *
 * Retire-if-active for the lanes this build no longer compares: the row
 * stays, marked inactive, and is never recreated because it is not among the
 * compared lanes. Only an ACTIVE one is written to, so a second boot is a
 * no-op rather than a re-deactivation. A retired row that fires before this
 * reaches it lands in the handler as a lane it does not have, which the
 * handler settles with a warning rather than a retry.
 *
 * A failure is logged and counted rather than thrown, so one bad tenant cannot
 * stop the rest of the fleet from being scheduled.
 */
async function ensureEntriesForTenant({
  scheduledJobs,
  targetType,
  tenantId,
  logger,
}: {
  scheduledJobs: ScheduledJobRepository;
  targetType: string;
  tenantId: string;
  logger: { warn: (context: unknown, message: string) => void };
}): Promise<{ created: number; deactivated: number; failed: number }> {
  const existing = await findEntriesForTenant({
    scheduledJobs,
    targetType,
    tenantId,
    logger,
  });
  // One unreadable tenant, counted and stepped over.
  if (existing === null) return { created: 0, deactivated: 0, failed: 1 };
  const existingTargetIds = new Set(existing.map((job) => job.targetId));

  const missing = COMPARED_COST_SOURCES.filter(
    (costSource) =>
      !existingTargetIds.has(
        costRollupComparatorTargetId({ tenantId, costSource }),
      ),
  );

  const retired = await switchOffEntries({
    scheduledJobs,
    targetType,
    tenantId,
    logger,
    jobs: existing.filter(
      (row) => row.active && isRetiredTargetId(row.targetId),
    ),
    failureMessage:
      "Retiring the cost rollup comparator entry for a lane no longer compared failed; the next boot retries it",
  });

  let created = 0;
  let failed = retired.failed;
  for (const costSource of missing) {
    try {
      await scheduledJobs.upsertForTarget({
        projectId: tenantId,
        targetType,
        targetId: costRollupComparatorTargetId({ tenantId, costSource }),
        cron: COST_ROLLUP_COMPARATOR_CRON,
        timezone: COST_ROLLUP_COMPARATOR_TIMEZONE,
        nextRunAt: computeNextRunAt({
          cron: COST_ROLLUP_COMPARATOR_CRON,
          timezone: COST_ROLLUP_COMPARATOR_TIMEZONE,
          after: new Date(),
        }),
      });
      created += 1;
    } catch (error) {
      failed += 1;
      // The aggregate count alone strands an operator: name the tenant and
      // the reason so a nonzero `failed` is actionable.
      logger.warn(
        {
          tenantId,
          cost_source: costSource,
          error: error instanceof Error ? error.message : String(error),
        },
        "Scheduling the cost rollup comparator for this tenant failed; the next boot retries it",
      );
    }
  }
  return { created, deactivated: retired.deactivated, failed };
}

/**
 * The given entries, switched off one by one.
 *
 * The caller decides WHICH rows — an archived tenant's live ones, a live
 * tenant's retired lane — and this only does the writes, so the two paths
 * cannot drift on how a switch-off is counted or how its failure is reported.
 *
 * Failures are logged and counted, never thrown, for the same reason as the
 * creation path: a tenant whose rows will not switch off must not cost the
 * tenants behind it their schedule.
 */
async function switchOffEntries({
  scheduledJobs,
  targetType,
  tenantId,
  logger,
  jobs,
  failureMessage,
}: {
  scheduledJobs: ScheduledJobRepository;
  targetType: string;
  tenantId: string;
  logger: { warn: (context: unknown, message: string) => void };
  jobs: ScheduledJobRecord[];
  failureMessage: string;
}): Promise<{ deactivated: number; failed: number }> {
  let deactivated = 0;
  let failed = 0;
  for (const job of jobs) {
    try {
      await scheduledJobs.deactivateForTarget({
        projectId: tenantId,
        targetType,
        targetId: job.targetId,
      });
      deactivated += 1;
    } catch (error) {
      failed += 1;
      logger.warn(
        {
          tenantId,
          targetId: job.targetId,
          error: error instanceof Error ? error.message : String(error),
        },
        failureMessage,
      );
    }
  }
  return { deactivated, failed };
}

/**
 * One archived tenant's live entries, switched off.
 *
 * Only what is actually there and still active, so the count reports work done
 * rather than no-op writes against tenants that never had an entry.
 */
async function deactivateEntriesForTenant({
  scheduledJobs,
  targetType,
  tenantId,
  logger,
}: {
  scheduledJobs: ScheduledJobRepository;
  targetType: string;
  tenantId: string;
  logger: { warn: (context: unknown, message: string) => void };
}): Promise<{ deactivated: number; failed: number }> {
  const existing = await findEntriesForTenant({
    scheduledJobs,
    targetType,
    tenantId,
    logger,
  });
  if (existing === null) return { deactivated: 0, failed: 1 };

  return switchOffEntries({
    scheduledJobs,
    targetType,
    tenantId,
    logger,
    jobs: existing.filter((row) => row.active),
    failureMessage:
      "Switching off the cost rollup comparator for this archived tenant failed; the next boot retries it",
  });
}

/**
 * Give every governance project its comparator entries, retire the entries
 * for lanes this build no longer compares, and take everything away from
 * projects that have been archived — a comparator firing daily at a dead
 * tenant is pure noise on the mismatch counter.
 *
 * `deactivated` counts both kinds of switch-off: the retired lane on a live
 * tenant and every entry on an archived one. Either way it is an entry that
 * was firing and now is not, which is what the boot log line reports.
 */
export async function reconcileCostRollupComparatorSchedules({
  prisma,
  scheduledJobs,
  targetType,
  logger,
}: {
  prisma: PrismaClient;
  scheduledJobs: ScheduledJobRepository;
  targetType: string;
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
    const result = await ensureEntriesForTenant({
      scheduledJobs,
      targetType,
      tenantId: project.id,
      logger,
    });
    created += result.created;
    deactivated += result.deactivated;
    failed += result.failed;
  }

  for (const project of archived) {
    const result = await deactivateEntriesForTenant({
      scheduledJobs,
      targetType,
      tenantId: project.id,
      logger,
    });
    deactivated += result.deactivated;
    failed += result.failed;
  }

  return { created, deactivated, failed };
}
