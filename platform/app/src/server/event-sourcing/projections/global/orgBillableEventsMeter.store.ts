import { createLogger } from "@langwatch/observability";
import { getApp } from "~/server/app-layer/app";
import { resolveOrganizationId } from "~/server/organizations/resolveOrganizationId";
import type { AppendStore } from "../mapProjection.types";
import type { ProjectionStoreContext } from "../projectionStoreContext";

const logger = createLogger("langwatch:billing:orgBillableEventsMeter");

export interface BillableEventRecord {
  organizationId: string;
  tenantId: string;
  eventId: string;
  eventType: string;
  deduplicationKey: string;
  eventTimestamp: number;
}

/**
 * AppendStore that records billable events to ClickHouse for deduplicated counting.
 *
 * - Resolves organizationId from tenantId (projectId) via shared cache
 * - Inserts into the billable_events ClickHouse table
 * - If ClickHouse client is null (not configured), silently skips (non-SaaS)
 * - If ClickHouse insert fails, throws so the queue retries
 * - If org not found (orphan project), skips with warn log
 */
export const orgBillableEventsMeterStore: AppendStore<BillableEventRecord> = {
  async append(
    record: BillableEventRecord,
    _context: ProjectionStoreContext,
  ): Promise<void> {
    const organizationId = await resolveOrganizationId(record.tenantId);
    if (!organizationId) {
      logger.warn(
        { projectId: record.tenantId },
        "orphan project detected, has no organization -- skipping billable event insert",
      );
      return;
    }

    await getApp().billing.events.insert({ record, organizationId });
  },
};
