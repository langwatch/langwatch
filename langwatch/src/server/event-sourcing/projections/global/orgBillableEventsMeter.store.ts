import type { AppendStore } from "../mapProjection.types";
import type { ProjectionStoreContext } from "../projectionStoreContext";
import { getClickHouseClient } from "~/server/clickhouse/client";
import { createLogger } from "~/utils/logger/server";
import { resolveOrganizationId } from "~/server/organizations/resolveOrganizationId";

const logger = createLogger("langwatch:billing:orgBillableEventsMeter");

const TABLE_NAME = "billable_events" as const;

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
 * - If ClickHouse insert fails, throws for BullMQ retry
 * - If org not found (orphan project), skips with warn log
 */
export const orgBillableEventsMeterStore: AppendStore<BillableEventRecord> = {
  async append(
    record: BillableEventRecord,
    _context: ProjectionStoreContext,
  ): Promise<void> {
    const client = getClickHouseClient();
    if (!client) {
      logger.debug("ClickHouse not configured, skipping billable event insert");
      return;
    }

    const organizationId = await resolveOrganizationId(record.tenantId);
    if (!organizationId) {
      logger.warn(
        { projectId: record.tenantId },
        "orphan project detected, has no organization -- skipping billable event insert",
      );
      return;
    }

    await client.insert({
      table: TABLE_NAME,
      values: [
        {
          OrganizationId: organizationId,
          TenantId: record.tenantId,
          EventId: record.eventId,
          EventType: record.eventType,
          DeduplicationKey: record.deduplicationKey,
          EventTimestamp: new Date(record.eventTimestamp),
        },
      ],
      format: "JSONEachRow",
    });
  },
};
