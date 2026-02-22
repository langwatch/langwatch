import type { AppendStore } from "../../library/projections/mapProjection.types";
import type { ProjectionStoreContext } from "../../library/projections/projectionStoreContext";
import { createLogger } from "~/utils/logger/server";
import { USAGE_REPORTING_QUEUE } from "~/server/background/queues/constants";
import type { OrgBillingMeterDispatchRecord } from "./orgBillingMeterDispatch.mapProjection";
import {
  resolveOrganizationId,
  clearOrgCache,
} from "~/server/organizations/resolveOrganizationId";

const logger = createLogger("langwatch:billing:meterDispatch");

const FIVE_MINUTES_MS = 5 * 60 * 1000;

/**
 * AppendStore that dispatches billing meter events to the usage reporting queue.
 *
 * For each billable event, resolves the owning organization and enqueues a
 * debounced usage reporting job. BullMQ's jobId deduplication ensures only
 * one job per organization is active within the debounce window.
 */
export const orgBillingMeterDispatchStore: AppendStore<OrgBillingMeterDispatchRecord> =
  {
    async append(
      record: OrgBillingMeterDispatchRecord,
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

      try {
        await usageReportingQueue.add(
          USAGE_REPORTING_QUEUE.JOB,
          { organizationId },
          {
            jobId: `usage_report_${organizationId}`,
            delay: FIVE_MINUTES_MS,
          },
        );
      } catch (error) {
        logger.warn(
          { organizationId, error },
          "failed to enqueue usage reporting job, events are safe in ClickHouse",
        );
      }
    },
  };

export { clearOrgCache };
