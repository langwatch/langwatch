import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";

import {
  type StoredTraceCount,
  TRACE_COUNT_PROJECTION_VERSION,
  TraceCountRepository,
  type TraceCountState,
  traceCountStateSchema,
} from "../trace-count.repository.ts";

const TABLE_NAME = "usage_trace_count" as const;

type TotalRow = { total: string | number };
type ProjectTotalRow = TotalRow & { projectId: string };
type StateRow = { foldState: string; appliedEventIds: string[] };

/** ClickHouse twin of the trace count; the table is migration 00107, deduped on read by argMax. */
export class TraceCountClickHouseRepository extends TraceCountRepository {
  readonly #clickhouse: ClickHouseQueryClient;

  private constructor(clickhouse: ClickHouseQueryClient) {
    super();
    this.#clickhouse = clickhouse;
  }

  static create(clickhouse: ClickHouseQueryClient): TraceCountClickHouseRepository {
    return new TraceCountClickHouseRepository(clickhouse);
  }

  async find({
    organizationId,
    projectId,
    month,
  }: {
    organizationId: string;
    projectId: string;
    month: string;
  }): Promise<StoredTraceCount[]> {
    const result = await this.#clickhouse.query<StateRow>({
      tenantId: projectId,
      organizationId,
      table: TABLE_NAME,
      sql: `
        SELECT
          argMax(FoldState, UpdatedAt) AS foldState,
          argMax(AppliedEventIds, UpdatedAt) AS appliedEventIds
        FROM ${TABLE_NAME}
        WHERE OrganizationId = {organizationId:String}
          AND Month = {month:Date}
          AND TenantId = {tenantId:String}
        GROUP BY TenantId
      `,
      params: { organizationId, tenantId: projectId, month: `${month}-01` },
    });
    return result.rows.map((row) => ({
      state: traceCountStateSchema.parse(JSON.parse(row.foldState)),
      appliedEventIds: row.appliedEventIds,
    }));
  }

  async save({
    organizationId,
    state,
    traces,
    appliedEventIds,
  }: {
    organizationId: string;
    state: TraceCountState;
    traces: number;
    appliedEventIds: readonly string[];
  }): Promise<void> {
    await this.#clickhouse.insert({
      tenantId: state.projectId,
      organizationId,
      table: TABLE_NAME,
      rows: [
        {
          OrganizationId: organizationId,
          TenantId: state.projectId,
          Month: `${state.month}-01`,
          Traces: traces,
          FoldState: JSON.stringify(state),
          AppliedEventIds: [...appliedEventIds],
          ProjectionVersion: TRACE_COUNT_PROJECTION_VERSION,
        },
      ],
      // The next fold of this project's month reads the row back.
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
        SELECT sum(Traces) AS total
        FROM (
          SELECT TenantId, argMax(Traces, UpdatedAt) AS Traces
          FROM ${TABLE_NAME}
          WHERE OrganizationId = {organizationId:String}
            AND Month = {month:Date}
          GROUP BY TenantId
        )
      `,
      params: { organizationId, month: `${month}-01` },
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
        SELECT TenantId AS projectId, argMax(Traces, UpdatedAt) AS total
        FROM ${TABLE_NAME}
        WHERE OrganizationId = {organizationId:String}
          AND Month = {month:Date}
          AND TenantId IN {projectIds:Array(String)}
        GROUP BY TenantId
      `,
      params: { organizationId, month: `${month}-01`, projectIds: [...projectIds] },
      // The organization's count reads every project the organization owns.
      SKIP_TENANT_CHECK: true,
    });
    return result.rows.map((row) => ({ projectId: row.projectId, count: totalOf(row.total) }));
  }
}

function totalOf(total: string | number | undefined): number {
  return typeof total === "number" ? total : Number.parseInt(total ?? "0", 10);
}
