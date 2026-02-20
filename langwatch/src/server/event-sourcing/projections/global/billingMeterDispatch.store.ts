import type { AppendStore } from "../../library/projections/mapProjection.types";
import type { ProjectionStoreContext } from "../../library/projections/projectionStoreContext";
import { TtlCache } from "~/server/utils/ttlCache";
import { prisma } from "~/server/db";
import { createLogger } from "~/utils/logger/server";
import { USAGE_REPORTING_QUEUE } from "~/server/background/queues/constants";
import type { BillingMeterDispatchRecord } from "./billingMeterDispatch.mapProjection";

const logger = createLogger("langwatch:billing:meterDispatch");

const TEN_MINUTES_MS = 10 * 60 * 1000;
const FIVE_MINUTES_MS = 5 * 60 * 1000;

/** Cache: projectId -> organizationId. Avoids repeated DB lookups. */
const orgCache = new TtlCache<string>(TEN_MINUTES_MS);

/**
 * Resolves the organizationId for a given projectId.
 *
 * Checks the TTL cache first; falls back to a Prisma query.
 * Returns undefined for orphan projects (no team or no organization).
 */
async function resolveOrganizationId(
  projectId: string,
): Promise<string | undefined> {
  const cached = orgCache.get(projectId);
  if (cached) {
    return cached;
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { team: { select: { organizationId: true } } },
  });

  const organizationId = project?.team?.organizationId;
  if (organizationId) {
    orgCache.set(projectId, organizationId);
  }

  return organizationId ?? undefined;
}

/**
 * AppendStore that dispatches billing meter events to the usage reporting queue.
 *
 * For each billable event, resolves the owning organization and enqueues a
 * debounced usage reporting job. BullMQ's jobId deduplication ensures only
 * one job per organization is active within the debounce window.
 */
export const billingMeterDispatchStore: AppendStore<BillingMeterDispatchRecord> =
  {
    async append(
      record: BillingMeterDispatchRecord,
      _context: ProjectionStoreContext,
    ): Promise<void> {
      const organizationId = await resolveOrganizationId(record.tenantId);

      if (!organizationId) {
        logger.warn(
          { projectId: record.tenantId },
          "orphan project detected, has no organization -- skipping billing dispatch",
        );
        return;
      }

      // Dynamic import to avoid circular dependencies with Redis/BullMQ setup
      const { usageReportingQueue } = await import(
        "~/server/background/queues/usageReportingQueue"
      );

      if (!usageReportingQueue) {
        return;
      }

      await usageReportingQueue.add(
        USAGE_REPORTING_QUEUE.JOB,
        { organizationId },
        {
          jobId: `usage_report:${organizationId}`,
          delay: FIVE_MINUTES_MS,
        },
      );
    },
  };

/** Exposed for testing: clears the org cache. */
export function clearOrgCache(): void {
  orgCache.clear();
}
