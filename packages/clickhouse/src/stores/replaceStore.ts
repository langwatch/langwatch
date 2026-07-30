/**
 * The `ReplaceStore<State>` a fold writes through, over a `ReplacingMergeTree`
 * table (ADR-098, ADR-099, ADR-102). Four properties live here once rather than
 * in each pipeline's copy: the version gate runs before any cell is decoded, so
 * a mismatch is `undecodable` and never `absent`; reads are read-your-writes;
 * writes are durable-first; and there is no redelivery guard, because a fold is
 * a function of the SET of its events (ADR-098 §5).
 */

import type { z } from "zod";
import type {
  ReplaceStore,
  StateRead,
  StoreContext,
  StoredState,
} from "@langwatch/event-sourcing";
import type { ClickHouseClient } from "../client/clickhouseClient";
import { bindIdentifiers } from "../query/identifiers";
import {
  type AnyWireColumn,
  createRowCodec,
  type WireCodec,
} from "../codec/rowCodec";
import type { ColumnMap } from "../schema/columns";
import type { TableDefinition, TableRow } from "../schema/defineTable";
import { deriveRowMapping, type RowMapping } from "./rowMapping";

/**
 * Thrown at construction when a wiring violates one of the structural rules
 * this adapter depends on, so a bad wiring fails a deploy rather than
 * corrupting a fold's state the first time it runs.
 */
export class ReplaceStoreConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReplaceStoreConfigurationError";
  }
}

/**
 * ClickHouse's mechanism for read-your-writes:
 * `select_sequential_consistency` makes the coordinator fetch the latest
 * committed log position from Keeper before executing, so a read following a
 * completed write for the same key observes it even when a load balancer routes
 * the two calls to different replicas. The cost is one Keeper round trip per
 * read; the alternative is a stale read silently restarting a fold from
 * `init()`.
 */
const READ_YOUR_WRITES_SETTINGS = {
  select_sequential_consistency: 1,
} as const;

/** Platform default, mirroring the deployed migrations' `_retention_days`. */
const DEFAULT_RETENTION_DAYS = 308;

/**
 * A tier in front of the table. Its failure semantics belong to the store, not
 * the caller: a write that lands durably but fails to cache deletes the key
 * rather than leaving a stale entry, because a stale entry means the next read
 * serves superseded state (ADR-098).
 */
export interface FoldStateCache<State> {
  get(key: string, context: StoreContext): Promise<StoredState<State> | null>;
  set(
    key: string,
    stored: StoredState<State>,
    context: StoreContext,
  ): Promise<void>;
  delete(key: string, context: StoreContext): Promise<void>;
}

/** Every read is a miss. For a fold that has decided to pay a point read per
 * delivery — a deliberate choice, spelled out, rather than an omission. */
export function noFoldStateCache<State>(): FoldStateCache<State> {
  return {
    get: () => Promise.resolve(null),
    set: () => Promise.resolve(),
    delete: () => Promise.resolve(),
  };
}

export interface ClickHouseReplacingArgs<State, Columns extends ColumnMap> {
  readonly client: ClickHouseClient;
  /** Must declare `merge: replacing({ version })` (ADR-099). */
  readonly table: TableDefinition<Columns>;
  /**
   * The state-shape version this build writes and expects to read. A stored row
   * disagreeing is reported `undecodable`, never decoded, never absent.
   */
  readonly version: string;
  /**
   * How the fold's key locates a row. A column name where the key is one
   * column; a decomposition where the engine key is composite, in which case
   * every named column is bound and the fold key is split across them.
   */
  readonly key:
    | (keyof Columns & string)
    | {
        readonly columns: readonly (keyof Columns & string)[];
        readonly split: (key: string) => readonly string[];
      };
  /** The column holding the state-shape version. */
  readonly stateVersionColumn: keyof Columns & string;
  /** Defaults to the table's single declared tenant column. */
  readonly tenant?: keyof Columns & string;
  /**
   * The fold's state schema. Given, the row mapping is derived from it and the
   * table's columns; otherwise `row` must supply the mapping.
   */
  readonly state?: z.ZodType<State>;
  readonly row?: RowMapping<State, Columns>;
  /**
   * Required, not optional. A fold reads its prior state back on every
   * delivery, so an unfronted store is one ClickHouse point read per event —
   * and forgetting the cache is silent, which is how the experiment-run fold
   * ended up the only one paying it. Pass `noFoldStateCache()` to opt out
   * deliberately.
   */
  readonly cache: FoldStateCache<NoInfer<State>>;
  readonly retentionDays?: number;
  /**
   * Bounds the read on a sort-key column that leads the key columns, so a
   * time-leading key is a seek rather than a tenant-range scan. A windowed miss
   * always retries unwindowed before reporting `absent`, because reporting a row
   * that exists outside the window as absent is the silent population-wide reset
   * ADR-107 decision 9 exists to prevent.
   */
  readonly readWindow?: { readonly column: string; readonly lookbackMs: number };
  /** @default createRowCodec() */
  readonly codec?: WireCodec;
}

export function clickhouseReplacing<State, Columns extends ColumnMap>(
  args: ClickHouseReplacingArgs<State, Columns>,
): ReplaceStore<State> {
  const { client, table, version, key, stateVersionColumn, cache } = args;
  const codec = args.codec ?? createRowCodec();
  const defaultRetentionDays = args.retentionDays ?? DEFAULT_RETENTION_DAYS;

  if (table.merge.kind !== "replacing") {
    throw new ReplaceStoreConfigurationError(
      `replace store for table "${table.name}": table declares merge kind "${table.merge.kind}", ` +
        `but a fold needs replacing({ version }) — an aggregating or append table has no single ` +
        `current row to read back (ADR-099)`,
    );
  }

  const tenant = args.tenant ?? soleTenantColumn(table);
  const keyColumns = typeof key === "string" ? [key] : key.columns;
  const splitKey =
    typeof key === "string" ? (value: string) => [value] : key.split;
  if (keyColumns.length === 0) {
    throw new ReplaceStoreConfigurationError(
      `replace store for table "${table.name}": key names no column`,
    );
  }
  for (const column of keyColumns) requireColumn(table, column, "key");
  requireColumn(table, stateVersionColumn, "stateVersionColumn");
  requireColumn(table, tenant, "tenant");

  // The read binds the tenant, the key columns, and any declared window
  // column, so exactly those must be the front of the sort key. A column
  // merely present further along still scans.
  const windowColumn = args.readWindow?.column;
  if (windowColumn !== undefined) {
    requireColumn(table, windowColumn, "readWindow.column");
  }
  const bound = new Set<string>([tenant, ...keyColumns]);
  const boundWithWindow =
    windowColumn === undefined ? bound : new Set([...bound, windowColumn]);
  const prefix = new Set(table.sortKey.slice(0, boundWithWindow.size));
  for (const column of boundWithWindow) {
    if (!prefix.has(column)) {
      const needed = [...boundWithWindow].join(", ");
      throw new ReplaceStoreConfigurationError(
        `replace store for table "${table.name}": the sort key [${table.sortKey.join(", ")}] ` +
          `must start with [${needed}] — a read bound on those alone would otherwise scan. ` +
          `A time-leading key is seekable only behind a declared readWindow on that column (ADR-109)`,
      );
    }
  }

  const mapping = args.row ?? deriveMapping();

  function deriveMapping(): RowMapping<State, Columns> {
    if (!args.state) {
      throw new ReplaceStoreConfigurationError(
        `replace store for table "${table.name}": pass either the fold's state schema ` +
          `or an explicit row mapping`,
      );
    }
    return deriveRowMapping<State, Columns>({
      table,
      state: args.state,
      key: keyColumns,
      tenant,
      stateVersionColumn,
    });
  }

  const columns = table.columns as ColumnMap;
  const stateVersionCol = columns[stateVersionColumn]!;
  const versionIndex = table.columnNames.indexOf(stateVersionColumn);
  const wireColumns: readonly AnyWireColumn[] = table.wireColumns;

  // Every table, column and value in the read is a bound parameter — nothing is
  // interpolated into the SQL, identifiers included. It is a point lookup on
  // the full key, not a scanning dedup subquery.
  const names = bindIdentifiers();
  const keyPredicate = keyColumns
    .map((column, index) => `AND ${names.of(column)} = {key${index}:String}`)
    .join(" ");
  const selectFrom =
    `SELECT ${names.list(table.columnNames)} ` +
    `FROM ${names.of(table.name)} ` +
    `WHERE ${names.of(tenant)} = {tenantId:String} ${keyPredicate} `;
  const orderLimit = `ORDER BY ${names.of(table.merge.version)} DESC LIMIT 1`;
  const readSql = selectFrom + orderLimit;

  const windowChType =
    windowColumn === undefined
      ? undefined
      : table.columns[windowColumn]?.chType;
  const windowedReadSql =
    windowColumn === undefined
      ? undefined
      : `${selectFrom}AND ${names.of(windowColumn)} >= {windowFrom:${windowChType}} ${orderLimit}`;
  const windowFrom = (now: number): string | Date => {
    const from = now - (args.readWindow?.lookbackMs ?? 0);
    return windowChType === "UInt64" || windowChType === "Int64"
      ? String(from)
      : new Date(from);
  };

  const keyParams = (foldKey: string): Record<string, string> => {
    const parts = splitKey(foldKey);
    if (parts.length !== keyColumns.length) {
      throw new ReplaceStoreConfigurationError(
        `replace store for table "${table.name}": key "${foldKey}" split into ${parts.length} ` +
          `parts but ${keyColumns.length} key columns are declared`,
      );
    }
    return Object.fromEntries(parts.map((part, index) => [`key${index}`, part]));
  };

  const queryRow = (foldKey: string, context: StoreContext, windowed: boolean) =>
    client.query({
      tenantId: context.tenantId,
      sql: windowed ? (windowedReadSql ?? readSql) : readSql,
      params: {
        ...names.params,
        tenantId: context.tenantId,
        ...keyParams(foldKey),
        ...(windowed && windowedReadSql !== undefined
          ? { windowFrom: windowFrom(Date.now()) }
          : {}),
      },
      settings: READ_YOUR_WRITES_SETTINGS,
    });

  const readFromTable = async (
    foldKey: string,
    context: StoreContext,
  ): Promise<StateRead<State>> => {
    // A windowed miss is not an answer: the row may simply be older than the
    // window, and reporting that as absent would refold the aggregate from
    // genesis and overwrite it.
    let result = await queryRow(foldKey, context, windowedReadSql !== undefined);
    if (!result.rows[0] && windowedReadSql !== undefined) {
      result = await queryRow(foldKey, context, false);
    }
    const row = result.rows[0];
    if (!row) return { kind: "absent" };

    // The gate runs on the version cell alone, at its declared position, before
    // any other cell is decoded: an old shape is not guaranteed to parse safely
    // under the current schema, and where it happens to parse it means
    // something this build does not intend.
    let storedVersion: string | undefined;
    try {
      storedVersion = stateVersionCol.decode(row[versionIndex]) as string;
    } catch (cause) {
      return { kind: "undecodable", storedVersion: undefined, cause };
    }
    if (storedVersion !== version) {
      return { kind: "undecodable", storedVersion };
    }

    try {
      const [decoded] = codec.decodeRows<TableRow<Columns>>({
        columns: wireColumns,
        columnNames: table.columnNames,
        header: result.header,
        rows: [row],
      });
      if (!decoded) return { kind: "undecodable", storedVersion };
      return {
        kind: "found",
        stored: { state: mapping.fromRow(decoded), version: storedVersion },
      };
    } catch (cause) {
      return { kind: "undecodable", storedVersion, cause };
    }
  };

  return {
    kind: "replace",

    async read(
      foldKey: string,
      context: StoreContext,
    ): Promise<StateRead<State>> {
      if (cache) {
        // An unreachable cache is a miss, never an error: the state is still in
        // the durable store, so losing the tier costs latency and the
        // read-your-writes window, not correctness (ADR-107 decision 10).
        const cached = await cache
          .get(foldKey, context)
          .catch(() => null as StoredState<State> | null);
        if (cached?.version === version) {
          return { kind: "found", stored: cached };
        }
        // An entry under any other version is dropped rather than reported:
        // reporting it would make the fold unrecoverable, because nothing else
        // ever clears the key.
        if (cached) await cache.delete(foldKey, context).catch(() => undefined);
      }
      const read = await readFromTable(foldKey, context);
      if (cache && read.kind === "found") {
        // Populating the tier is best-effort for the same reason: the row was
        // already found, so a failure here must not fail the read.
        await cache.set(foldKey, read.stored, context).catch(() => undefined);
      }
      return read;
    },

    async write(
      foldKey: string,
      stored: StoredState<State>,
      context: StoreContext,
    ): Promise<void> {
      const row = mapping.toRow(stored.state, {
        tenantId: context.tenantId,
        key: foldKey,
        version: stored.version,
        writtenAt: new Date(),
        retentionDays: context.retentionDays ?? defaultRetentionDays,
      });

      const encodedRows = codec.encodeRows({
        columns: wireColumns,
        columnNames: table.columnNames,
        rows: [row],
      });

      await client.insert({
        tenantId: context.tenantId,
        table: table.name,
        rows: encodedRows,
        columns: table.columnNames,
        target: { kind: "replacing" },
      });

      if (!cache) return;
      // Durable first, cached second. A cache write that fails deletes the key
      // rather than leaving a stale one behind, and a cache that is down does
      // not fail a write that already landed.
      try {
        await cache.set(foldKey, stored, context);
      } catch {
        await cache.delete(foldKey, context).catch(() => undefined);
      }
    },
  };
}

function soleTenantColumn<Columns extends ColumnMap>(
  table: TableDefinition<Columns>,
): keyof Columns & string {
  const [only, ...rest] = table.tenant;
  if (!only || rest.length > 0) {
    throw new ReplaceStoreConfigurationError(
      `replace store for table "${table.name}": the table declares ${table.tenant.length} tenant ` +
        `columns, so one must be named explicitly`,
    );
  }
  return only;
}

function requireColumn<Columns extends ColumnMap>(
  table: TableDefinition<Columns>,
  candidate: string,
  purpose: string,
): void {
  if (!table.columnNames.includes(candidate)) {
    throw new ReplaceStoreConfigurationError(
      `replace store for table "${table.name}": ${purpose} "${candidate}" is not one of the table's columns`,
    );
  }
}
