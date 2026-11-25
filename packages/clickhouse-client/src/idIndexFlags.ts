/**
 * The shared vocabulary of the id indexes (dev/docs/plans/id-index-2026-10-10.md): whether an
 * owner's index may be trusted on a ClickHouse target, and the one point read of an index that
 * answers the time range an id's rows live in.
 */

/** The ClickHouse target a tenant's statements land on: `"shared"` or its private organisation. */
export const SHARED_CLICKHOUSE_TARGET = "shared";

/**
 * Whether an owner's id indexes are filled on a target, answered from memory. Built by the owner
 * as an `IdIndexReadiness` over its own indexes; an absent `IdIndexFlags` reads as off everywhere.
 */
export interface IdIndexFlags {
  isOn(input: { target: string }): boolean;
}

/**
 * What an index holds for the ids asked: `n` index rows, and the earliest and latest time of
 * their source rows in epoch ms. `n = 0` is a miss, and its times mean nothing.
 */
export type IdIndexBounds = { n: number; fromMs: number; toMs: number };

/**
 * The index columns after `TenantId` a lookup matches, each to one value or a set of values:
 * `{ TraceId: ["t1", "t2"] }`, or `{ AggregateType: "trace", AggregateId: "t1" }`.
 */
export type IdIndexKey = Readonly<Record<string, string | readonly string[]>>;

/** How an index stores `FromAt`/`ToAt`: the source's `DateTime64(3)`, or epoch ms (`event_log`). */
export type IdIndexTimeFormat = "datetime64" | "epoch_ms";

/** One index lookup, as a repository names it; the reader supplies the tenant predicate. */
export type IdIndexLookup = {
  index: string;
  key: IdIndexKey;
  timeFormat?: IdIndexTimeFormat | undefined;
};

/** Anything an id lookup can ask for its target and its index bounds: the client or the fence. */
export interface IdIndexReader {
  targetOf(input: { tenantId: string }): Promise<string>;
  indexBounds(input: IdIndexLookup & { tenantId: string }): Promise<IdIndexBounds>;
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Table and column names are written into the statement, so only plain identifiers pass. */
export function assertIdentifier({ name }: { name: string }): string {
  if (!IDENTIFIER.test(name)) throw new Error(`"${name}" is not a plain ClickHouse identifier.`);
  return name;
}

const millisOf = ({
  expression,
  timeFormat,
}: {
  expression: string;
  timeFormat: IdIndexTimeFormat;
}) =>
  timeFormat === "epoch_ms" ? `toInt64(${expression})` : `toUnixTimestamp64Milli(${expression})`;

/**
 * The point read of one index under a tenant predicate the caller owns (`TenantId = {…}` on the
 * client, the proof's tenant set in the fence). Pure, so both readers send the same statement.
 */
export function idIndexBoundsStatement({
  index,
  key,
  timeFormat = "datetime64",
  tenantPredicate,
}: IdIndexLookup & { tenantPredicate: string }): {
  sql: string;
  params: Record<string, unknown>;
} {
  const entries = Object.entries(key);
  if (entries.length === 0) throw new Error(`A lookup of ${index} names no key column.`);
  const params: Record<string, unknown> = {};
  const matches = entries.map(([column, value], position) => {
    const param = `idIndexKey${position}`;
    params[param] = typeof value === "string" ? value : [...value];
    const name = assertIdentifier({ name: column });
    return typeof value === "string"
      ? `${name} = {${param}:String}`
      : `${name} IN ({${param}:Array(String)})`;
  });
  const sql =
    `SELECT count() AS n, ${millisOf({ expression: "min(FromAt)", timeFormat })} AS fromMs, ` +
    `${millisOf({ expression: "max(ToAt)", timeFormat })} AS toMs ` +
    `FROM ${assertIdentifier({ name: index })} WHERE ${tenantPredicate} AND ${matches.join(" AND ")}`;
  return { sql, params };
}

/** JSONEachRow quotes 64-bit integers, so each field arrives as a number or a numeric string. */
export function idIndexBoundsOf({ rows }: { rows: readonly unknown[] }): IdIndexBounds {
  const [row] = rows;
  const field = (name: string): number => {
    if (typeof row !== "object" || row === null) return 0;
    const value: unknown = Reflect.get(row, name);
    const parsed = typeof value === "number" ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  return { n: field("n"), fromMs: field("fromMs"), toMs: field("toMs") };
}

/**
 * One index an owner fills, as its migration declares it. `retentionAnchor` is the column the
 * source expires on; when it is not `time`, the index carries it as `RetainAt`. `retention` is
 * `"copied"` from `_retention_days` (0 kept as 65535), or `"none"` for a source without it.
 */
export type IdIndexDeclaration = Readonly<{
  source: string;
  index: string;
  key: readonly string[];
  time: string;
  retentionAnchor: string;
  retention: "copied" | "none";
  filter?: string | undefined;
  /** How the source's `time` and the index's `FromAt`/`ToAt` are stored; `DateTime64` default. */
  timeFormat?: IdIndexTimeFormat | undefined;
}>;

/** `ExperimentId` as `experiment_id`: a key column as an index name spells it. */
function snakeCaseOf({ column }: { column: string }): string {
  return column
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1_$2")
    .toLowerCase();
}

/**
 * An id index's table name: `<source>_id_index` for a source's first, and `<source>_by_<key>_index`
 * for a second on other key columns (`experiment_runs_by_experiment_id_index`).
 */
export function idIndexName({
  source,
  key,
  by = false,
}: {
  source: string;
  key: readonly string[];
  by?: boolean | undefined;
}): string {
  if (!by) return `${source}_id_index`;
  return `${source}_by_${key.map((column) => snakeCaseOf({ column })).join("_")}_index`;
}

/**
 * Declares one id index the way its goose file creates it: named by `idIndexName`, expiring on
 * `time` and copying the source's `_retention_days` unless told otherwise.
 */
export function defineIdIndex({
  source,
  key,
  time,
  by,
  retentionAnchor = time,
  retention = "copied",
  filter,
  timeFormat,
}: {
  source: string;
  key: readonly string[];
  time: string;
  /** A source's second index, on other key columns: named `<source>_by_<key>_index`. */
  by?: true | undefined;
  retentionAnchor?: string | undefined;
  retention?: "copied" | "none" | undefined;
  filter?: string | undefined;
  timeFormat?: IdIndexTimeFormat | undefined;
}): IdIndexDeclaration {
  if (key.length === 0) throw new Error(`The id index over ${source} names no key column.`);
  return {
    source: assertIdentifier({ name: source }),
    index: idIndexName({ source, key, by }),
    key: key.map((column) => assertIdentifier({ name: column })),
    time: assertIdentifier({ name: time }),
    retentionAnchor: assertIdentifier({ name: retentionAnchor }),
    retention,
    ...(filter === undefined ? {} : { filter }),
    ...(timeFormat === undefined ? {} : { timeFormat }),
  };
}
