/**
 * Shared ClickHouse stand-ins for the analytics read-back repository suites.
 *
 * The trace and evaluation repositories are separate types with the same read
 * contract, so their tests need the same two fakes. Keeping one copy here means
 * the ORDER BY parser cannot drift between them and quietly stop proving the
 * tiebreak in one suite while still proving it in the other.
 */
import type { WriteTarget } from "@langwatch/clickhouse";
import { register } from "prom-client";
import type { TenantClickHouseClient } from "~/server/app-layer/clients/clickhouse/tenant-client";

export interface CapturedQuery {
  sql: string;
  params?: Record<string, unknown>;
  table?: string;
}

export interface CapturedInsert {
  table?: string;
  rows?: unknown;
  target?: WriteTarget;
  settings?: Record<string, unknown>;
}

/**
 * A client that records the parameters of every `insert` and does nothing else.
 *
 * The durability settings are no longer the repository's to pass — the package
 * client merges them last and refuses to let a caller weaken them — so what is
 * observable here is the write TARGET, which is what decides whether a failed
 * insert may be re-sent.
 */
export function capturingInsertClient(): {
  client: TenantClickHouseClient;
  inserts: CapturedInsert[];
} {
  const inserts: CapturedInsert[] = [];
  const client = {
    insert: async (params: CapturedInsert) => {
      inserts.push(params);
    },
  } as unknown as TenantClickHouseClient;
  return { client, inserts };
}

/**
 * A client that returns one fixed record — the decoded, column-named row shape
 * the tenant client hands back, where DateTime64 columns arrive as strings.
 */
export function clientReturning(
  record: Record<string, unknown>,
): TenantClickHouseClient {
  return {
    query: async () => [record],
  } as unknown as TenantClickHouseClient;
}

/**
 * A client that actually APPLIES the ORDER BY the repository sent, to rows
 * handed over in a deliberately adverse order.
 *
 * This is the point of the fake: a passthrough mock would return the fixture's
 * own insertion order and pass whatever the repository did, so a dropped
 * tiebreak — or one aimed at the wrong column or direction — would go unnoticed.
 * Here the stale version wins unless the repository ordered correctly.
 *
 * Understands only the grammar the repositories emit: comma-separated
 * `<column> ASC|DESC` and `length(<column>) DESC` keys, then LIMIT 1.
 */
export function orderingClient(rows: Array<Record<string, unknown>>): {
  client: TenantClickHouseClient;
  seen: CapturedQuery[];
} {
  const seen: CapturedQuery[] = [];
  const client = {
    query: async (params: CapturedQuery) => {
      seen.push(params);
      return applyOrderBy(rows, params.sql).slice(0, 1);
    },
  } as unknown as TenantClickHouseClient;
  return { client, seen };
}

export function applyOrderBy(
  rows: Array<Record<string, unknown>>,
  query: string,
): Array<Record<string, unknown>> {
  const clause = /ORDER BY([\s\S]*?)LIMIT/i.exec(query)?.[1];
  if (clause === undefined) return [...rows];

  const keys = clause
    .split(",")
    .map((key) => key.trim())
    .filter((key) => key.length > 0)
    .map((key) => {
      const descending = /\bDESC\b/i.test(key);
      const expression = key.replace(/\b(ASC|DESC)\b/i, "").trim();
      const arrayLength = /^length\((.+)\)$/i.exec(expression);
      return {
        column: arrayLength ? arrayLength[1]!.trim() : expression,
        descending,
        byLength: arrayLength !== null,
      };
    });

  return [...rows].sort((left, right) => {
    for (const { column, descending, byLength } of keys) {
      const a = sortValue(left[column], byLength);
      const b = sortValue(right[column], byLength);
      if (a === b) continue;
      return (a < b ? -1 : 1) * (descending ? -1 : 1);
    }
    return 0;
  });
}

/** UInt64 columns arrive as strings on the wire; DateTime64 sorts lexically. */
export function sortValue(raw: unknown, byLength: boolean): number | string {
  if (byLength) return Array.isArray(raw) ? raw.length : 0;
  if (typeof raw === "number") return raw;
  const asString = String(raw);
  return asString !== "" && !Number.isNaN(Number(asString))
    ? Number(asString)
    : asString;
}

/** Current `clickhouse_windowed_read_total` for one table+outcome pair. */
export async function windowedReadCount({
  table,
  outcome,
}: {
  table: string;
  outcome: string;
}): Promise<number> {
  const metric = register.getSingleMetric("clickhouse_windowed_read_total");
  if (!metric) return 0;
  const snapshot = await metric.get();
  return (
    snapshot.values.find(
      (value) =>
        value.labels.table === table && value.labels.outcome === outcome,
    )?.value ?? 0
  );
}
