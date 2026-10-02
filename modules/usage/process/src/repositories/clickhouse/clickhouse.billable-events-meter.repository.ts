import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { Temporal, toDate, toEpochMs } from "@langwatch/time";

import {
  BillableEventsMeterRepository,
  type BillableEventRecord,
  type MeterWindow,
} from "../billable-events-meter.repository.ts";

const TABLE_NAME = "billable_events" as const;

type TotalRow = { total: string | number };

/** ClickHouse twin of the meter, moved from billing under the same table and row shape. */
export class BillableEventsMeterClickHouseRepository extends BillableEventsMeterRepository {
  readonly #clickhouse: ClickHouseQueryClient;

  private constructor(clickhouse: ClickHouseQueryClient) {
    super();
    this.#clickhouse = clickhouse;
  }

  static create(clickhouse: ClickHouseQueryClient): BillableEventsMeterClickHouseRepository {
    return new BillableEventsMeterClickHouseRepository(clickhouse);
  }

  async insert({
    record,
    organizationId,
  }: {
    record: BillableEventRecord;
    organizationId: string;
  }): Promise<void> {
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

  async findTotal(input: { organizationId: string } & MeterWindow): Promise<number> {
    const result = await this.#clickhouse.query<TotalRow>({
      tenantId: "",
      organizationId: input.organizationId,
      sql: `
        SELECT countDistinct(DeduplicationKeyHash) as total
        FROM ${TABLE_NAME}
        WHERE OrganizationId = {organizationId:String}
          AND EventTimestamp >= {startDate:DateTime64(3)}
          AND EventTimestamp < {endDate:DateTime64(3)}
      `,
      params: {
        organizationId: input.organizationId,
        startDate: input.startDate,
        endDate: input.endDate,
      },
      unscoped: { reason: "The organization's meter counts every project the organization owns." },
    });
    const total = result.rows[0]?.total;
    return typeof total === "number" ? total : Number.parseInt(total ?? "0", 10);
  }
}
