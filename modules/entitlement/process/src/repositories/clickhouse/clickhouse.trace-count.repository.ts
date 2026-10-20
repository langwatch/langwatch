import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { Temporal } from "@langwatch/time";

import { TraceCountRepository, type TraceUsageRow } from "../trace-count.repository.ts";

const TABLE_NAME = "usage_trace_meter" as const;

type TotalRow = { total: string | number };
type ProjectTotalRow = TotalRow & { projectId: string };

/**
 * ClickHouse twin of the trace count; the table is migration 00104. Reads group by trace instead
 * of FINAL, and count a trace only in the earliest month it has a row, looking back one month.
 */
export class TraceCountClickHouseRepository extends TraceCountRepository {
  readonly #clickhouse: ClickHouseQueryClient;

  private constructor(clickhouse: ClickHouseQueryClient) {
    super();
    this.#clickhouse = clickhouse;
  }

  static create(clickhouse: ClickHouseQueryClient): TraceCountClickHouseRepository {
    return new TraceCountClickHouseRepository(clickhouse);
  }

  async insert({
    organizationId,
    rows,
  }: {
    organizationId: string;
    rows: readonly TraceUsageRow[];
  }): Promise<void> {
    const first = rows[0];
    if (!first) return;
    await this.#clickhouse.insert({
      tenantId: first.projectId,
      organizationId,
      table: TABLE_NAME,
      rows: rows.map((row) => ({
        OrganizationId: organizationId,
        TenantId: row.projectId,
        Month: `${row.month}-01`,
        TraceId: row.traceId,
      })),
      settings: { async_insert: 1, wait_for_async_insert: 1 },
    });
  }

  async findTotal({
    organizationId,
    month,
  }: {
    organizationId: string;
    month: string;
  }): Promise<number> {
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
      params: { organizationId, ...monthParams(month) },
      // The organization's count sums every project the organization owns.
      SKIP_TENANT_CHECK: true,
    });
    return totalOf(result.rows[0]?.total);
  }

  async countByProjects({
    organizationId,
    projectIds,
    month,
  }: {
    organizationId: string;
    projectIds: readonly string[];
    month: string;
  }): Promise<{ projectId: string; count: number }[]> {
    if (projectIds.length === 0) return [];
    const result = await this.#clickhouse.query<ProjectTotalRow>({
      tenantId: "",
      organizationId,
      table: TABLE_NAME,
      sql: `
        SELECT TenantId AS projectId, countIf(FirstMonth = {month:Date}) AS total
        FROM (
          SELECT TenantId, TraceId, min(Month) AS FirstMonth
          FROM ${TABLE_NAME}
          WHERE OrganizationId = {organizationId:String}
            AND Month >= {previousMonth:Date}
            AND Month <= {month:Date}
            AND TenantId IN {projectIds:Array(String)}
          GROUP BY TenantId, TraceId
        )
        GROUP BY TenantId
        HAVING total > 0
      `,
      params: { organizationId, projectIds: [...projectIds], ...monthParams(month) },
      // The organization's count reads every project the organization owns.
      SKIP_TENANT_CHECK: true,
    });
    return result.rows.map((row) => ({ projectId: row.projectId, count: totalOf(row.total) }));
  }
}

function monthParams(month: string): { month: string; previousMonth: string } {
  const start = Temporal.PlainYearMonth.from(month);
  return {
    month: `${start.toString()}-01`,
    previousMonth: `${start.subtract({ months: 1 }).toString()}-01`,
  };
}

function totalOf(total: string | number | undefined): number {
  return typeof total === "number" ? total : Number.parseInt(total ?? "0", 10);
}
