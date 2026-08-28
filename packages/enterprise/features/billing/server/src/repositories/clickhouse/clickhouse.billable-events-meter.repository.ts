// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Writes billable events for deduplicated usage counting.
 *
 * Organization-scoped rather than tenant-scoped: billing routes ClickHouse
 * per organization (private-instance customers get their own), and the
 * caller has already resolved the organization for the tenant before this is
 * reached. The resolver mirrors `getClickHouseClientForOrganization`'s
 * signature rather than the tenant-keyed resolver most repositories take —
 * and returns `null` where ClickHouse is not configured at all, which is the
 * self-hosted case this write is simply skipped on.
 */
import { createLogger } from "@langwatch/observability";
import type { BillableEventsMeterClickHouseClientResolver } from "../../adapters/clickhouse.billable-events-meter.adapter";
import {
  BillableEventsMeterPort,
  type BillableEventRecord,
} from "../../ports/billable-events-meter.port";

const logger = createLogger("langwatch:billing:billable-events-repository");

const TABLE_NAME = "billable_events" as const;

export class BillableEventsMeterClickHouseRepository extends BillableEventsMeterPort {
  private constructor(private readonly resolveClient: BillableEventsMeterClickHouseClientResolver) {
    super();
  }

  static create(options: {
    resolveClient: BillableEventsMeterClickHouseClientResolver;
  }): BillableEventsMeterClickHouseRepository {
    return new BillableEventsMeterClickHouseRepository(options.resolveClient);
  }

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
