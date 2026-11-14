/**
 * Set membership over trace_summaries without dedup via TenantId-first predicate.
 */
import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { clickhouseRead, fn, tenantScope } from "@langwatch/clickhouse-client/builder";
import { createLogger, type Logger } from "@langwatch/observability";
import type { TraceCost, TraceUsageCount } from "@langwatch/trace-contract";
import { z } from "zod";

import { TraceExistenceRepository } from "../trace-existence.repository.ts";
import { storedSpans } from "./clickhouse.stored-spans.table.ts";
import { traceSummaries as summaries } from "./clickhouse.trace-summaries.table.ts";
import { chNumber, chString } from "./stored-span-row.mapper.ts";

const traceIdRowsSchema = z.array(z.looseObject({ TraceId: chString }));
const totalRowsSchema = z.array(z.looseObject({ Total: chString }));
const traceCostRowsSchema = z.array(
  z.looseObject({ TraceId: chString, TotalCost: chNumber.nullable() }),
);

export class ClickHouseTraceExistenceRepository extends TraceExistenceRepository {
  static create(options: {
    clickhouse: Pick<ClickHouseQueryClient, "read">;
  }): ClickHouseTraceExistenceRepository {
    return new ClickHouseTraceExistenceRepository(options.clickhouse);
  }

  private readonly logger: Pick<Logger, "warn"> = createLogger("langwatch:trace:existence");

  private constructor(private readonly clickhouse: Pick<ClickHouseQueryClient, "read">) {
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
    const statement = clickhouseRead({ scope: tenantScope.single({ tenantId: projectId }) })
      .from(summaries)
      .select({ TraceId: summaries.TraceId })
      .distinct()
      .where(({ idBound }) => idBound(summaries.TraceId, traceIds))
      .build();
    try {
      // A ready index's miss means absent; a hit is still confirmed on the source.
      const result = await this.clickhouse.read({
        statement,
        table: summaries.$table.name,
        idBound: { onMiss: "none" },
      });
      const rows = traceIdRowsSchema.parse(result.rows);
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
    // Bounded by the caller's own occurred-time range, not by id; the election repeats it.
    const statement = clickhouseRead({ scope: tenantScope.single({ tenantId: projectId }) })
      .from(summaries)
      .select({ TraceId: summaries.TraceId, TotalCost: summaries.TotalCost })
      .where(({ oneOf }) => oneOf(summaries.TraceId, traceIds))
      .where(({ and, gte, lte }) =>
        and(gte(summaries.OccurredAt, occurredAt.from), lte(summaries.OccurredAt, occurredAt.to)),
      )
      .latestVersion()
      .build();
    const result = await this.clickhouse.read({ statement, table: summaries.$table.name });
    return traceCostRowsSchema
      .parse(result.rows)
      .map((row) => ({ traceId: row.TraceId, totalCost: row.TotalCost }));
  }

  async countUsage({
    projectIds,
    since,
  }: {
    projectIds: readonly string[];
    since?: number;
  }): Promise<TraceUsageCount> {
    const perProject = await Promise.all(
      [...new Set(projectIds)].map(async (projectId) => {
        const scope = tenantScope.single({ tenantId: projectId });
        const allTraces = clickhouseRead({ scope })
          .from(summaries)
          .select({ Total: fn.toString(fn.countDistinct(summaries.TraceId)) });
        const allSpans = clickhouseRead({ scope })
          .from(storedSpans)
          .select({ Total: fn.toString(fn.count()) });
        const traces = (
          since === undefined
            ? allTraces
            : allTraces.where(({ gte }) => gte(summaries.OccurredAt, since))
        ).build();
        const spans = (
          since === undefined
            ? allSpans
            : allSpans.where(({ gte }) => gte(storedSpans.StartTime, since))
        ).build();
        const totalOf = async (rows: Promise<{ rows: readonly unknown[] }>) => {
          const [row] = totalRowsSchema.parse((await rows).rows);
          return Number.parseInt(row?.Total ?? "0", 10);
        };
        const [traceTotal, spanTotal] = await Promise.all([
          totalOf(this.clickhouse.read({ statement: traces, table: summaries.$table.name })),
          totalOf(this.clickhouse.read({ statement: spans, table: storedSpans.$table.name })),
        ]);
        return { traces: traceTotal, spans: spanTotal };
      }),
    );
    return {
      traces: perProject.reduce((sum, row) => sum + row.traces, 0),
      spans: perProject.reduce((sum, row) => sum + row.spans, 0),
    };
  }
}
