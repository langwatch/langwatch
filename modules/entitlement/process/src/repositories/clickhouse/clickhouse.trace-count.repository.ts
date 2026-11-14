import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import {
  clickhouseRead,
  fn,
  param,
  tenantScope,
  type TenantSetScope,
} from "@langwatch/clickhouse-client/builder";
import { Temporal } from "@langwatch/time";

import { TraceCountRepository, type TraceUsageRow } from "../trace-count.repository.ts";
import { usageTraceMeter as meter } from "./clickhouse.usage-trace-meter.table.ts";

/** Inserts as written; every read is built and sent on the reader over a project set (ADR-202). */
type TraceCountClickHouse = Pick<ClickHouseQueryClient, "insert" | "read">;

/**
 * The month's reads group every trace of two months, so their hash table grows with the
 * organization's volume. Spilling the GROUP BY to disk past this size keeps a large organization's
 * count under the per-query memory cap instead of failing it; the ingest doors ask it per batch.
 */
const SPILL_GROUP_BY_BYTES = 256 * 1024 * 1024;

/**
 * ClickHouse twin of the trace count (migration 00104). Reads group by a 64-bit hash of each trace,
 * never FINAL: a third of the memory of grouping by id. A trace counts only in the earliest month
 * it has a row, looking back one month.
 */
export class TraceCountClickHouseRepository extends TraceCountRepository {
  readonly #clickhouse: TraceCountClickHouse;

  private constructor(clickhouse: TraceCountClickHouse) {
    super();
    this.#clickhouse = clickhouse;
  }

  static create(clickhouse: TraceCountClickHouse): TraceCountClickHouseRepository {
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
      table: meter.$table.name,
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
    projectIds,
    month,
  }: {
    organizationId: string;
    projectIds: readonly string[];
    month: string;
  }): Promise<number> {
    if (projectIds.length === 0) return 0;
    const months = monthParams(month);
    const scope = tenantScope.set({ tenantIds: projectIds });
    const read = organizationMonths({ scope, organizationId, months });
    const traceKey = fn.sipHash64(fn.tuple(meter.TenantId, meter.TraceId));
    const firstSeen = read
      .select({ TraceKey: traceKey, FirstMonth: fn.min(meter.Month) })
      .groupBy(traceKey)
      .as("first_seen");
    const statement = clickhouseRead({ scope })
      .from(firstSeen)
      .select(({ eq }) => ({ total: fn.countIf(eq(firstSeen.FirstMonth, months.month)) }))
      .settings({ max_bytes_before_external_group_by: SPILL_GROUP_BY_BYTES })
      .build();
    const result = await this.#clickhouse.read({ statement, table: meter.$table.name });
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
    const months = monthParams(month);
    const scope = tenantScope.set({ tenantIds: projectIds });
    const read = organizationMonths({ scope, organizationId, months });
    // The project's position in the set, not its id, keeps each group's key two integers wide.
    const projectIndex = fn.indexOf(param.strings(projectIds), meter.TenantId);
    const traceKey = fn.sipHash64(meter.TraceId);
    const firstSeen = read
      .select({ ProjectIndex: projectIndex, TraceKey: traceKey, FirstMonth: fn.min(meter.Month) })
      .groupBy(projectIndex, traceKey)
      .as("first_seen");
    const statement = clickhouseRead({ scope })
      .from(firstSeen)
      .select(({ eq }) => ({
        ProjectIndex: firstSeen.ProjectIndex,
        total: fn.countIf(eq(firstSeen.FirstMonth, months.month)),
      }))
      .groupBy(firstSeen.ProjectIndex)
      .having(({ eq, gt }) => gt(fn.countIf(eq(firstSeen.FirstMonth, months.month)), 0))
      .settings({ max_bytes_before_external_group_by: SPILL_GROUP_BY_BYTES })
      .build();
    const result = await this.#clickhouse.read({ statement, table: meter.$table.name });
    return result.rows.flatMap((row) => {
      const projectId = projectIds[totalOf(row.ProjectIndex) - 1];
      return projectId === undefined ? [] : [{ projectId, count: totalOf(row.total) }];
    });
  }
}

/** The organization's rows of the month and the one before, on the reader over its projects. */
function organizationMonths({
  scope,
  organizationId,
  months,
}: {
  scope: TenantSetScope;
  organizationId: string;
  months: { month: string; previousMonth: string };
}) {
  return clickhouseRead({ scope })
    .from(meter)
    .where(({ and, eq, gte, lte }) =>
      and(
        eq(meter.OrganizationId, organizationId),
        gte(meter.Month, months.previousMonth),
        lte(meter.Month, months.month),
      ),
    );
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
