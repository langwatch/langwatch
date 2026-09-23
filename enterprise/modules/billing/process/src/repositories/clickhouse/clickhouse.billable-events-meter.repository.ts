// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { Temporal, toDate, toEpochMs } from "@langwatch/time";

import {
  BillableEventsMeter,
  type BillableEventRecord,
} from "../billable-events-meter.repository.ts";

const TABLE_NAME = "billable_events" as const;

/** ClickHouse write side for deduplicated usage counting. */
export class BillableEventsMeterClickHouseRepository extends BillableEventsMeter {
  readonly #clickhouse: ClickHouseQueryClient;

  private constructor(clickhouse: ClickHouseQueryClient) {
    super();
    this.#clickhouse = clickhouse;
  }

  static create(clickhouse: ClickHouseQueryClient): BillableEventsMeterClickHouseRepository {
    return new BillableEventsMeterClickHouseRepository(clickhouse);
  }

  async insert(input: { record: BillableEventRecord; organizationId: string }): Promise<void> {
    const { record, organizationId } = input;
    await this.#clickhouse.insert({
      tenantId: record.tenantId,
      organizationId,
      table: TABLE_NAME,
      rows: [
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
      settings: { async_insert: 1, wait_for_async_insert: 1 },
    });
  }
}
