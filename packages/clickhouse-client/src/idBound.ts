/**
 * The `{{idBound:<table>.<Key>:<param>}}` marker (id-index plan §4): a read by id names its table,
 * key column and id parameter, and the reader adds the time bound its id index names. The
 * declarations and their readiness live here, one record per index per ClickHouse target.
 */
import type { IdIndexDeclaration } from "./idIndexFill.ts";
import type { IdIndexBounds, IdIndexKey, IdIndexLookup } from "./idIndexFlags.ts";
import {
  type IdIndexMarkerStatements,
  IdIndexReadiness,
  idIndexReadinessTargets,
} from "./idIndexReadiness.ts";
import { indexedRead } from "./indexedRead.ts";
import { ID_BOUND_PARAM_PREFIX, StatementScopeError } from "./statementScopeError.ts";
import {
  DEFAULT_PARTITION_WINDOW_MS,
  fallbackFragment,
  incrementWindowedReadCount,
  queryWindowed,
  type WindowedReadOutcome,
  type WindowFallback,
  type WindowFragment,
  windowFragment,
} from "./windowedRead.ts";

const NAME = "[A-Za-z_][A-Za-z0-9_]*";
const NAMES = `${NAME}(?:,${NAME})*`;

/** `{{idBound:<table>.<Key>[,<Key>]:<param>[,<param>][:<alias>]}}`, one param per key column. */
export const ID_BOUND_MARKER = new RegExp(
  `\\{\\{idBound:(${NAME})\\.(${NAMES}):(${NAMES})(?::(${NAME}))?\\}\\}`,
  "g",
);

/**
 * What a not-ready read's resolver found: a time to read around, a window to read inside (open
 * above with no `toMs`), `undefined` to read unbounded, or `null` for an id with no row.
 */
export type IdBoundResolved =
  | number
  | { fromMs: number; toMs?: number | undefined }
  | null
  | undefined;

/** A read's own knobs for the bound: a known time first, and today's fallback while not ready. */
export type IdBoundOptions = {
  /** A time the caller already has (epoch ms); its window is read first. */
  occurredAtHint?: number | null | undefined;
  /** Half-width of the hinted window; two days by default. */
  windowMs?: number | undefined;
  /**
   * What a read does while the index is not ready: unbounded by default, as before the index.
   * `"none"` with a hint is a hard range: a ready index only narrows it.
   */
  fallback?: WindowFallback | undefined;
  /** What an id the index has never seen reads: the 35-day probe, `"unbounded"`, or nothing. */
  onMiss?: WindowFallback | undefined;
  /** Bounds the read from below only: a live trace runs past any upper bound. */
  openEnded?: boolean | undefined;
  /**
   * While the index is not ready and no hint was given, looks the id's time up from the source,
   * as reads did before the index: a time bounds the next read, `undefined` reads unbounded,
   * and `null` says the id has no row, so nothing more is read.
   */
  resolveHint?: (() => Promise<IdBoundResolved>) | undefined;
  /** Consults `resolveHint` after a hinted window misses too, not only when no hint was given. */
  resolveOnHintMiss?: boolean | undefined;
};

/** Where the readiness checks and marker writes go: the routed client. */
export type IdIndexRegistryStatements = IdIndexMarkerStatements & {
  privateRoutes(): ReadonlyMap<string, string>;
};

type Registered = { declaration: IdIndexDeclaration; readiness: IdIndexReadiness };

/** Which declared index a source and key columns name: the source's first index, or a second. */
type IndexSelector = { source: string; key: readonly string[] };

/**
 * Every id index a process declared, by index, each with its readiness per target. A source may
 * carry several on different keys; declaring the same index again is a no-op, and a different
 * index under the same name, or on the same source and key, is refused.
 */
export class IdIndexRegistry {
  private readonly byIndex = new Map<string, Registered>();

  constructor(private readonly statements: IdIndexRegistryStatements) {}

  declare({ indexes }: { indexes: readonly IdIndexDeclaration[] }): void {
    for (const declaration of indexes) {
      const known = [...this.byIndex.values()].find(
        (each) =>
          each.declaration.index === declaration.index ||
          (each.declaration.source === declaration.source &&
            sameKey({ left: each.declaration.key, right: declaration.key })),
      );
      if (known !== undefined) {
        if (sameDeclaration({ left: known.declaration, right: declaration })) continue;
        throw new Error(
          `Two different id indexes are declared over ${declaration.source} as ${declaration.index}.`,
        );
      }
      const statements = this.statements;
      const readiness = IdIndexReadiness.create({
        statements,
        indexes: [declaration],
        watch: () => idIndexReadinessTargets({ privateRoutes: statements.privateRoutes() }),
      });
      this.byIndex.set(declaration.index, { declaration, readiness });
    }
  }

  /** Every declared index, in declaration order: the fill's and the retention raise's list. */
  declarations(): IdIndexDeclaration[] {
    return [...this.byIndex.values()].map((each) => each.declaration);
  }

  /**
   * The index a read by `key` on `source` uses: the one keyed exactly so, else the first whose
   * key starts with it, as `ExperimentId` alone reads `[ExperimentId, RunId]`.
   */
  declarationOf(selector: IndexSelector): IdIndexDeclaration | undefined {
    return this.registeredOf(selector)?.declaration;
  }

  /** Whether the selected index is ready on the target, from memory; an undeclared one is not. */
  isReady({ target, ...selector }: IndexSelector & { target: string }): boolean {
    return this.registeredOf(selector)?.readiness.isOn({ target }) ?? false;
  }

  /** Checks one index on one target now, or joins the check in flight. */
  check({ target, ...selector }: IndexSelector & { target: string }): Promise<boolean> {
    return this.registeredOf(selector)?.readiness.check({ target }) ?? Promise.resolve(false);
  }

  private registeredOf({ source, key }: IndexSelector): Registered | undefined {
    const onSource = [...this.byIndex.values()].filter(
      (each) => each.declaration.source === source,
    );
    return (
      onSource.find((each) => sameKey({ left: each.declaration.key, right: key })) ??
      onSource.find((each) =>
        sameKey({ left: each.declaration.key.slice(0, key.length), right: key }),
      )
    );
  }
}

function sameKey({ left, right }: { left: readonly string[]; right: readonly string[] }): boolean {
  return left.length === right.length && left.every((column, at) => column === right[at]);
}

function sameDeclaration({
  left,
  right,
}: {
  left: IdIndexDeclaration;
  right: IdIndexDeclaration;
}): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** One statement's parsed marker: the index it names, the ids it looks up, and its renderer. */
export type IdBound = Readonly<{
  declaration: IdIndexDeclaration;
  lookup: IdIndexLookup;
  /** The statement with every marker replaced by `window`'s bound, or by nothing when `null`. */
  render(
    window: WindowFragment | null,
    openEnded?: boolean,
  ): { sql: string; params: Record<string, unknown> };
}>;

/** Whether a statement carries an `{{idBound}}` marker at all. */
export function hasIdBound({ sql }: { sql: string }): boolean {
  return sql.includes("{{idBound:");
}

/**
 * Parses a statement's `{{idBound}}` markers against the declarations, or `null` when it has
 * none. Refuses an undeclared table, a key that is not the index's, an id parameter that is not
 * bound to a string or strings, markers for different ids, and a reserved parameter.
 */
export function idBoundOf({
  sql,
  params,
  registry,
  openEnded = false,
}: {
  sql: string;
  params: Record<string, unknown>;
  registry: Pick<IdIndexRegistry, "declarationOf" | "declarations"> | undefined;
  /** Renders the lower bound alone, for a live read whose rows run past any upper one. */
  openEnded?: boolean | undefined;
}): IdBound | null {
  const marker = markerOf({ sql });
  if (marker === null) return null;
  for (const param of Object.keys(params)) {
    if (param.startsWith(ID_BOUND_PARAM_PREFIX)) {
      throw new StatementScopeError({ kind: "reserved-param", param });
    }
  }
  const { table } = marker;
  const declaration = registry?.declarationOf({ source: table, key: marker.columns.split(",") });
  if (declaration === undefined) {
    const declared = registry?.declarations().some((each) => each.source === table) ?? false;
    if (!declared) throw new StatementScopeError({ kind: "unknown-id-index", table });
    throw new StatementScopeError({
      kind: "id-index-key-mismatch",
      table,
      columns: marker.columns,
    });
  }
  const lookup: IdIndexLookup = {
    index: declaration.index,
    key: keyOf({ declaration, marker, params }),
    timeFormat: declaration.timeFormat,
  };
  return {
    declaration,
    lookup,
    render: (window, openWindow = openEnded) => ({
      sql: sql.replace(ID_BOUND_MARKER, (_marker, ...groups: unknown[]) =>
        window === null ? "" : boundSql({ alias: groups[3], declaration, openEnded: openWindow }),
      ),
      params:
        window === null
          ? params
          : {
              ...params,
              [`${ID_BOUND_PARAM_PREFIX}_fromMs`]: window.fromMs,
              [`${ID_BOUND_PARAM_PREFIX}_toMs`]: window.toMs,
            },
    }),
  };
}

type Marker = { table: string; columns: string; names: string };

/** The one id a statement's markers name; markers naming different ids are refused. */
function markerOf({ sql }: { sql: string }): Marker | null {
  const markers = [...sql.matchAll(ID_BOUND_MARKER)].map(
    ([, table = "", columns = "", names = ""]) => ({ table, columns, names }),
  );
  const [first] = markers;
  if (first === undefined) return null;
  const differs = (other: Marker) =>
    other.table !== first.table || other.columns !== first.columns || other.names !== first.names;
  if (markers.some(differs)) throw new StatementScopeError({ kind: "mixed-id-bounds" });
  return first;
}

/** The index lookup's key: each named key column, a prefix of the declared key, to its ids. */
function keyOf({
  declaration,
  marker,
  params,
}: {
  declaration: IdIndexDeclaration;
  marker: Marker;
  params: Record<string, unknown>;
}): IdIndexKey {
  const keyColumns = marker.columns.split(",");
  const paramNames = marker.names.split(",");
  // A leading part of the key reads the index's ordered prefix, as `ExperimentId` alone does.
  const declaredPrefix = declaration.key.slice(0, keyColumns.length);
  if (
    keyColumns.join(",") !== declaredPrefix.join(",") ||
    paramNames.length !== keyColumns.length
  ) {
    throw new StatementScopeError({
      kind: "id-index-key-mismatch",
      table: marker.table,
      columns: marker.columns,
    });
  }
  const key: Record<string, string | readonly string[]> = {};
  keyColumns.forEach((column, position) => {
    const param = paramNames[position] ?? "";
    key[column] = idParamOf({ param, value: params[param] });
  });
  return key;
}

function idParamOf({ param, value }: { param: string; value: unknown }): string | string[] {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.every((each) => typeof each === "string")) return value;
  throw new StatementScopeError({ kind: "missing-id-param", param });
}

/** `AND <time> BETWEEN from AND to` on the marker's alias, in the time column's own format. */
function boundSql({
  alias,
  declaration,
  openEnded,
}: {
  alias: unknown;
  declaration: IdIndexDeclaration;
  openEnded: boolean;
}): string {
  const column = typeof alias === "string" ? `${alias}.${declaration.time}` : declaration.time;
  const epochMs = declaration.timeFormat === "epoch_ms";
  const at = (param: string) => {
    const slot = `{${ID_BOUND_PARAM_PREFIX}_${param}:Int64}`;
    return epochMs ? slot : `fromUnixTimestamp64Milli(${slot})`;
  };
  const lower = `AND ${column} >= ${at("fromMs")}`;
  return openEnded ? lower : `${lower} AND ${column} <= ${at("toMs")}`;
}

/**
 * Runs a statement bounded by its id index: the hint first; once ready, the index's range
 * widened a day each side, or the 35-day probe on a miss; not ready, today's windowed read with
 * the caller's fallback. Every path counts one outcome, as `indexedRead` does.
 */
export async function readIdBound<Row>({
  bound,
  tenantId,
  registry,
  targetOf,
  indexBounds,
  options,
  run,
}: {
  bound: IdBound;
  tenantId: string;
  registry: Pick<IdIndexRegistry, "isReady">;
  targetOf: () => Promise<string>;
  indexBounds: (lookup: IdIndexLookup) => Promise<IdIndexBounds>;
  options: IdBoundOptions | undefined;
  run: (statement: { sql: string; params: Record<string, unknown> }) => Promise<Row[]>;
}): Promise<Row[]> {
  const { source, key } = bound.declaration;
  const target = await targetOf();
  const read = (window: WindowFragment | null, openEnded?: boolean) =>
    run(bound.render(window, openEnded));
  if (!registry.isReady({ source, key, target })) {
    return readNotReady({ source, options, read });
  }
  const within = hardWindowOf({ options });
  return indexedRead<Row>({
    client: {
      targetOf: async () => target,
      indexBounds: (lookup) =>
        indexBounds({ index: lookup.index, key: lookup.key, timeFormat: lookup.timeFormat }),
    },
    idIndex: { isOn: () => true },
    tenantId,
    table: source,
    index: bound.lookup.index,
    key: bound.lookup.key,
    timeFormat: bound.lookup.timeFormat,
    hintMs: within === undefined ? (options?.occurredAtHint ?? null) : null,
    windowMs: options?.windowMs,
    fallback: options?.fallback ?? "unbounded",
    onMiss: options?.onMiss,
    within,
    isEmpty: (rows) => rows.length === 0,
    run: (window) => read(window),
  });
}

/**
 * A hint with fallback `"none"` is the caller's hard range, which a ready index may only narrow;
 * a hint the caller resolves past on a miss stays a hint.
 */
function hardWindowOf({
  options,
}: {
  options: IdBoundOptions | undefined;
}): WindowFragment | undefined {
  const hintMs = options?.occurredAtHint ?? null;
  if (hintMs === null || options?.fallback !== "none" || options.resolveOnHintMiss === true) {
    return undefined;
  }
  const windowMs = options.windowMs ?? DEFAULT_PARTITION_WINDOW_MS;
  return windowFragment({ fromMs: hintMs - windowMs, toMs: hintMs + windowMs });
}

/**
 * Today's read while the index is not ready: the hinted window then the fallback; with no hint,
 * or after a hinted miss where asked, the time the resolver looks up. Counted once by the last
 * attempt, as `queryWindowed` counts.
 */
async function readNotReady<Row>({
  source,
  options,
  read,
}: {
  source: string;
  options: IdBoundOptions | undefined;
  read: (window: WindowFragment | null, openEnded?: boolean) => Promise<Row[]>;
}): Promise<Row[]> {
  const windowMs = options?.windowMs ?? DEFAULT_PARTITION_WINDOW_MS;
  const fallback = options?.fallback ?? "unbounded";
  const hintMs = options?.occurredAtHint ?? null;
  const resolveHint = options?.resolveHint;
  const resolvesNow =
    resolveHint !== undefined && (hintMs === null || options?.resolveOnHintMiss === true);
  if (!resolvesNow) {
    return queryWindowed<Row[]>({
      table: source,
      hintMs,
      windowMs,
      fallback,
      isEmpty: (rows) => rows.length === 0,
      run: (window) => read(window),
    });
  }
  const around = (centre: number) =>
    windowFragment({ fromMs: centre - windowMs, toMs: centre + windowMs });
  try {
    if (hintMs !== null) {
      const hinted = await read(around(hintMs));
      if (hinted.length > 0) {
        incrementWindowedReadCount(source, "hit");
        return hinted;
      }
    }
    const resolved = await resolveHint();
    const rows =
      resolved === null ? [] : await readResolved({ resolved, fallback, windowMs, read, around });
    incrementWindowedReadCount(source, notReadyOutcome({ hintMs, rows }));
    return rows;
  } catch (error) {
    incrementWindowedReadCount(source, "error");
    throw error;
  }
}

/** The resolved time's window, widening to the fallback only when it misses and may widen. */
async function readResolved<Row>({
  resolved,
  fallback,
  windowMs,
  read,
  around,
}: {
  resolved: Exclude<IdBoundResolved, null>;
  fallback: WindowFallback;
  windowMs: number;
  read: (window: WindowFragment | null, openEnded?: boolean) => Promise<Row[]>;
  around: (centre: number) => WindowFragment;
}): Promise<Row[]> {
  if (resolved === undefined) return read(null);
  const rows =
    typeof resolved === "number"
      ? await read(around(resolved))
      : await read(
          windowFragment({ fromMs: resolved.fromMs, toMs: resolved.toMs ?? resolved.fromMs }),
          resolved.toMs === undefined,
        );
  if (rows.length > 0 || fallback === "none") return rows;
  return read(fallbackFragment(fallback, windowMs));
}

function notReadyOutcome({
  hintMs,
  rows,
}: {
  hintMs: number | null;
  rows: readonly unknown[];
}): WindowedReadOutcome {
  if (hintMs === null) return "unwindowed";
  return rows.length === 0 ? "unbounded_empty" : "unbounded_hit";
}
