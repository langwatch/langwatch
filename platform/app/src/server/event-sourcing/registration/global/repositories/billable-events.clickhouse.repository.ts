import type { ClickHouseClient } from "@clickhouse/client";
import { createLogger } from "@langwatch/observability";
import type { BillableEventRecord } from "../orgBillableEventsMeter.store";

const logger = createLogger("langwatch:billing:billable-events-repository");

const TABLE_NAME = "billable_events" as const;

export interface BillableEventsRepository {
  /** Inserts one deduplicated billable-event row. */
  insert(input: { record: BillableEventRecord; organizationId: string }): Promise<void>;
}

/**
 * Writes billable events for deduplicated usage counting.
 *
 * Organization-scoped rather than tenant-scoped: billing routes ClickHouse
 * per organization (private-instance customers get their own), and the
 * caller has already resolved the organization for the tenant before this is
 * reached. The resolver mirrors `getClickHouseClientForOrganization`'s
 * signature rather than the tenant-keyed `ClickHouseClientResolver` most
 * repositories take.
 */
export class BillableEventsMeterClickHouseRepository implements BillableEventsRepository {
  constructor(
    private readonly resolveClient: (
      organizationId: string,
    ) => Promise<ClickHouseClient | null>,
  ) {}

  async insert({
    record,
    organizationId,
  }: {
    record: BillableEventRecord;
    organizationId: string;
  }): Promise<void> {
    const client = await this.resolveClient(organizationId);
    if (!client) {
      logger.debug("ClickHouse not configured, skipping billable event insert");
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
      clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
    });
  }
}
