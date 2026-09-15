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
import type { ClickHouseSettings, DataFormat } from "@clickhouse/client";
import { createLogger } from "@langwatch/observability";
import {
  BillableEventsMeter,
  type BillableEventRecord,
} from "../billable-events-meter.repository.ts";
import { Temporal, toDate, toEpochMs } from "@langwatch/time";

const logger = createLogger("langwatch:billing:billable-events-repository");

const TABLE_NAME = "billable_events" as const;

/**
 * The one statement this meter issues, rather than a vendor client.
 *
 * Structural for the reason the metric and suite ports are: a background
 * worker composes this write over the Eventing substrate's own ClickHouse
 * client, which describes a `readonly` batch and the settings map generally.
 * Naming the driver class refused that client for no behavioural reason, while
 * a driver client still satisfies this shape.
 */
export interface BillableEventsMeterClickHouseClient {
  insert(params: {
    table: string;
    /** Read-only on purpose: nothing here mutates the batch it is handed. */
    values: readonly unknown[];
    format?: DataFormat;
    clickhouse_settings?: ClickHouseSettings;
  }): Promise<unknown>;
}

/**
 * Organization-keyed, and nullable: billing routes ClickHouse per organization,
 * and a deployment with no ClickHouse at all resolves to nothing rather than
 * failing — the meter is a SaaS-only write.
 */
export type BillableEventsMeterClickHouseClientResolver = (
  organizationId: string,
) => Promise<BillableEventsMeterClickHouseClient | null>;

export class BillableEventsMeterClickHouseRepository extends BillableEventsMeter {
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
          EventTimestamp: toDate(
            Temporal.Instant.fromEpochMilliseconds(toEpochMs(record.eventTimestamp)),
          ),
        },
      ],
      format: "JSONEachRow",
      clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
    });
  }
}
