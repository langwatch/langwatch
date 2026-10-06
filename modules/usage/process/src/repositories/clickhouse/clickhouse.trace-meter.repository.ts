import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { Temporal } from "@langwatch/time";
import { SPAN_RECEIVED_EVENT_TYPE } from "@langwatch/trace-contract";

import { TraceMeterRepository, type TraceMeterRecord } from "../trace-meter.repository.ts";

const TABLE_NAME = "usage_trace_meter" as const;
const SOURCE_TABLE_NAME = "billable_events" as const;

const SEED_UNSCOPED = {
  reason: "The seed folds every organization's month on the shared instance once.",
} as const;

type TotalRow = { total: string | number };

/** ClickHouse twin of the trace meter; the table is migration 00104. */
export class TraceMeterClickHouseRepository extends TraceMeterRepository {
  readonly #clickhouse: ClickHouseQueryClient;

  private constructor(clickhouse: ClickHouseQueryClient) {
    super();
    this.#clickhouse = clickhouse;
  }

  static create(clickhouse: ClickHouseQueryClient): TraceMeterClickHouseRepository {
    return new TraceMeterClickHouseRepository(clickhouse);
  }

  async insert({
    record,
    organizationId,
  }: {
    record: TraceMeterRecord;
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
          Month: `${record.month}-01`,
          TraceId: record.traceId,
        },
      ],
      settings: { async_insert: 1, wait_for_async_insert: 1 },
    });
  }

  /**
   * A trace counts in its first month: one seen last month is not counted again, so the read
   * prunes to two partitions. A trace silent for a whole month between spans counts twice.
   */
  async findTotal({
    organizationId,
    month,
  }: {
    organizationId: string;
    month: string;
  }): Promise<number> {
    const start = Temporal.PlainYearMonth.from(month);
    const result = await this.#clickhouse.query<TotalRow>({
      tenantId: "",
      organizationId,
      table: TABLE_NAME,
      sql: `
        SELECT countIf(FirstMonth = {month:Date}) AS total
        FROM (
          SELECT TenantId, TraceId, min(Month) AS FirstMonth
          FROM ${TABLE_NAME}
          WHERE OrganizationId = {organizationId:String}
            AND Month >= {previousMonth:Date}
            AND Month <= {month:Date}
          GROUP BY TenantId, TraceId
        )
      `,
      params: {
        organizationId,
        month: `${start.toString()}-01`,
        previousMonth: `${start.subtract({ months: 1 }).toString()}-01`,
      },
      unscoped: { reason: "The organization's meter counts every project the organization owns." },
    });
    return totalOf(result.rows);
  }

  async seedMonth({ month, dryRun }: { month: string; dryRun: boolean }): Promise<number> {
    // Each distinct trace of the month's span_received rows, read from the shared instance.
    const statement = (wrap: (source: string) => string) => ({
      sql: wrap(`
      SELECT DISTINCT OrganizationId, TenantId, splitByChar(':', DeduplicationKey)[2] AS TraceId
      FROM ${SOURCE_TABLE_NAME}
      WHERE EventType = {eventType:String}
        AND EventTimestamp >= {start:DateTime64(3)}
        AND EventTimestamp < {end:DateTime64(3)}
        AND OrganizationId != ''
        AND length(splitByChar(':', DeduplicationKey)) = 3
        AND splitByChar(':', DeduplicationKey)[1] = TenantId
    `),
      unscoped: SEED_UNSCOPED,
    });
    const start = Temporal.PlainYearMonth.from(month);
    const params = {
      eventType: SPAN_RECEIVED_EVENT_TYPE,
      month: `${start.toString()}-01`,
      start: `${start.toString()}-01 00:00:00.000`,
      end: `${start.add({ months: 1 }).toString()}-01 00:00:00.000`,
    };
    const counted = await this.#clickhouse.query<TotalRow>({
      tenantId: "",
      table: SOURCE_TABLE_NAME,
      ...statement((source) => `SELECT count() AS total FROM (${source})`),
      params,
    });
    if (dryRun) return totalOf(counted.rows);
    await this.#clickhouse.command({
      tenantId: "",
      table: TABLE_NAME,
      ...statement(
        (source) => `
          INSERT INTO ${TABLE_NAME} (OrganizationId, TenantId, Month, TraceId)
          SELECT OrganizationId, TenantId, toDate({month:String}) AS Month, TraceId
          FROM (${source})
        `,
      ),
      params,
    });
    return totalOf(counted.rows);
  }
}

function totalOf(rows: readonly TotalRow[]): number {
  const total = rows[0]?.total;
  return typeof total === "number" ? total : Number.parseInt(total ?? "0", 10);
}
