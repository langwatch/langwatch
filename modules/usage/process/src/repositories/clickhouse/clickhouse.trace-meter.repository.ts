import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { Temporal } from "@langwatch/time";

import { TraceMeterRepository, type TraceMeterRecord } from "../trace-meter.repository.ts";

const TABLE_NAME = "usage_trace_meter" as const;

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
    const total = result.rows[0]?.total;
    return typeof total === "number" ? total : Number.parseInt(total ?? "0", 10);
  }
}
