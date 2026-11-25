/**
 * Set membership over trace_summaries without dedup via TenantId-first predicate.
 */
import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { createLogger, type Logger } from "@langwatch/observability";
import type { TraceCost, TraceUsageCount } from "@langwatch/trace-contract";
import { z } from "zod";

import { TraceExistenceRepository } from "../trace-existence.repository.ts";
import type { TraceClickHouseResolver } from "./clickhouse.trace-member-client.repository.ts";
import { chNumber, chString } from "./stored-span-row.mapper.ts";

const traceIdRowsSchema = z.array(z.looseObject({ TraceId: chString }));
const tenantIdRowsSchema = z.array(z.looseObject({ TenantId: chString }));
const totalRowsSchema = z.array(z.looseObject({ Total: chString }));
const traceCostRowsSchema = z.array(
  z.looseObject({ TraceId: chString, TotalCost: chNumber.nullable() }),
);

export class ClickHouseTraceExistenceRepository extends TraceExistenceRepository {
  /** `clickhouse` serves the reads over a declared tenant set; absent, those refuse by name. */
  static create(options: {
    resolveClient: TraceClickHouseResolver;
    clickhouse?: ClickHouseQueryClient;
  }): ClickHouseTraceExistenceRepository {
    return new ClickHouseTraceExistenceRepository(options.resolveClient, options.clickhouse);
  }

  private readonly logger: Pick<Logger, "warn"> = createLogger("langwatch:trace:existence");

  private constructor(
    private readonly resolveClient: TraceClickHouseResolver,
    private readonly clickhouse: ClickHouseQueryClient | undefined,
  ) {
    super();
  }

  async findExistingTraceIds({
    projectId,
    traceIds,
  }: {
    projectId: string;
    traceIds: readonly string[];
  }): Promise<string[]> {
    if (traceIds.length === 0) return [];
    const client = await this.resolveClient(projectId);
    try {
      const result = await client.query({
        query: `
              SELECT DISTINCT TraceId
              FROM trace_summaries
              WHERE TenantId = {tenantId:String}
                AND TraceId IN ({traceIds:Array(String)})
                {{idBound:trace_summaries.TraceId:traceIds}}
            `,
        query_params: { tenantId: projectId, traceIds: [...traceIds] },
        format: "JSONEachRow",
        // A ready index's miss means absent; a hit is still confirmed on the source.
        idBound: { onMiss: "none" },
      });
      const rows = traceIdRowsSchema.parse(await result.json());
      return rows.map((row) => row.TraceId);
    } catch (error) {
      this.logger.warn(
        {
          projectId,
          traceIdCount: traceIds.length,
          error: error instanceof Error ? error.message : error,
        },
        "Failed to check trace existence in ClickHouse",
      );
      throw new Error("Failed to check which traces exist");
    }
  }

  /**
   * One statement per table over the whole set (`TenantId IN` plus `TraceId`, the sorting key's
   * prefix, so it prunes), each bounded by the id index: a miss the ready index has never seen
   * reads only the index. One organisation's projects, which the router requires of a set.
   */
  async findProjectsHoldingTrace({
    projectIds,
    traceId,
  }: {
    projectIds: readonly string[];
    traceId: string;
  }): Promise<string[]> {
    const tenantIds = [...new Set(projectIds)];
    const [firstTenantId] = tenantIds;
    if (firstTenantId === undefined) return [];
    const clickhouse = this.clickhouse;
    if (clickhouse === undefined) {
      throw new Error("No ClickHouse member was composed for a read over a tenant set");
    }
    const holdersIn = async (table: "trace_summaries" | "stored_spans") => {
      const result = await clickhouse.query({
        tenantId: firstTenantId,
        tenantIds,
        table,
        sql: `
          SELECT DISTINCT TenantId FROM ${table}
          WHERE TenantId IN ({tenantIds:Array(String)})
            AND TraceId = {traceId:String}
            {{idBound:${table}.TraceId:traceId}}`,
        params: { tenantIds, traceId },
        // A ready index's miss means absent; a hit is still confirmed on the source.
        idBound: { onMiss: "none" },
      });
      return tenantIdRowsSchema.parse(result.rows).map((row) => row.TenantId);
    };
    const holders = await Promise.all([holdersIn("trace_summaries"), holdersIn("stored_spans")]);
    return [...new Set(holders.flat())];
  }

  async findTraceCosts({
    projectId,
    traceIds,
    occurredAt,
  }: {
    projectId: string;
    traceIds: readonly string[];
    occurredAt: { from: number; to: number };
  }): Promise<TraceCost[]> {
    if (traceIds.length === 0) return [];
    const client = await this.resolveClient(projectId);
    const result = await client.query({
      // ID_BOUND_SKIP: bounded by the caller's own occurred-time range, not by id.
      query: `
          SELECT TraceId, TotalCost
          FROM trace_summaries
          WHERE TenantId = {tenantId:String}
            AND TraceId IN ({traceIds:Array(String)})
            AND OccurredAt >= fromUnixTimestamp64Milli({from:Int64})
            AND OccurredAt <= fromUnixTimestamp64Milli({to:Int64})
            AND (TenantId, TraceId, UpdatedAt) IN (
              SELECT TenantId, TraceId, max(UpdatedAt)
              FROM trace_summaries
              WHERE TenantId = {tenantId:String}
                AND TraceId IN ({traceIds:Array(String)})
              GROUP BY TenantId, TraceId
            )
        `,
      query_params: {
        tenantId: projectId,
        traceIds: [...traceIds],
        from: occurredAt.from,
        to: occurredAt.to,
      },
      format: "JSONEachRow",
    });
    return traceCostRowsSchema
      .parse(await result.json())
      .map((row) => ({ traceId: row.TraceId, totalCost: row.TotalCost }));
  }

  async countUsage({
    projectIds,
    since,
  }: {
    projectIds: readonly string[];
    since?: number;
  }): Promise<TraceUsageCount> {
    const window = (column: string) =>
      since === undefined ? "" : `AND ${column} >= fromUnixTimestamp64Milli({since:Int64})`;
    const perProject = await Promise.all(
      [...new Set(projectIds)].map(async (projectId) => {
        const client = await this.resolveClient(projectId);
        const count = async (query: string) => {
          const result = await client.query({
            query,
            query_params:
              since === undefined ? { tenantId: projectId } : { tenantId: projectId, since },
            format: "JSONEachRow",
          });
          const [row] = totalRowsSchema.parse(await result.json());
          return Number.parseInt(row?.Total ?? "0", 10);
        };
        const [traces, spans] = await Promise.all([
          count(`
            SELECT toString(count(DISTINCT TraceId)) AS Total
            FROM trace_summaries
            WHERE TenantId = {tenantId:String}
              ${window("OccurredAt")}`),
          count(`
            SELECT toString(count()) AS Total
            FROM stored_spans
            WHERE TenantId = {tenantId:String}
              ${window("StartTime")}`),
        ]);
        return { traces, spans };
      }),
    );
    return {
      traces: perProject.reduce((sum, row) => sum + row.traces, 0),
      spans: perProject.reduce((sum, row) => sum + row.spans, 0),
    };
  }
}
