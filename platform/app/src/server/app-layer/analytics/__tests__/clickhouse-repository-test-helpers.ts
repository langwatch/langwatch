/**
 * Shared ClickHouse stand-ins for the analytics read-back repository suites.
 *
 * The trace and evaluation repositories are separate types with the same read
 * contract, so their tests need the same two fakes. Keeping one copy here means
 * the ORDER BY parser cannot drift between them and quietly stop proving the
 * tiebreak in one suite while still proving it in the other.
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { register } from "prom-client";

export interface CapturedQuery {
  query: string;
  query_params?: Record<string, unknown>;
}

export interface CapturedInsert {
  table?: string;
  values?: unknown;
  format?: string;
  clickhouse_settings?: Record<string, unknown>;
}

/**
 * A client that records the parameters of every `insert` and does nothing else.
 *
 * `wrapWithDefaultSettings` proxies only `.query`, so nothing injects settings
 * into an insert on the way past — whatever the repository passes is exactly
 * what reaches ClickHouse. That is why the settings have to be asserted here on
 * the caller's own params rather than trusted to a wrapper.
 */
export function capturingInsertClient(): {
  client: ClickHouseClient;
  inserts: CapturedInsert[];
} {
  const inserts: CapturedInsert[] = [];
  const client = {
    insert: async (params: CapturedInsert) => {
      inserts.push(params);
      return { executed: true };
    },
  } as unknown as ClickHouseClient;
  return { client, inserts };
}

/**
 * A client that returns one fixed record — the wire shape ClickHouse produces
 * for JSONEachRow, where DateTime64 columns arrive as strings.
 */
export function clientReturning(
  record: Record<string, unknown>,
): ClickHouseClient {
  return {
    query: async () => ({ json: async () => [record] }),
  } as unknown as ClickHouseClient;
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
  client: ClickHouseClient;
  seen: CapturedQuery[];
} {
  const seen: CapturedQuery[] = [];
  const client = {
    query: async (params: CapturedQuery) => {
      seen.push(params);
      return { json: async () => applyOrderBy(rows, params.query).slice(0, 1) };
    },
  } as unknown as ClickHouseClient;
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
