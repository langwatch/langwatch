/**
 * Implements `@langwatch/event-sourcing`'s `ReplaceStore<State>` contract on a
 * `ReplacingMergeTree` table declared with `defineTable` (ADR-099, ADR-102).
 *
 * The core declares the contract and knows nothing about ClickHouse; this
 * module is one adopter of it. A fold's whole read-apply-write cycle depends
 * on things this store gets right that the executor cannot enforce itself:
 *
 * - **`undecodable`, never a throw, on a version mismatch.** The row's stored
 *   state-version column is compared against the version this build writes
 *   *before* the state payload is ever decoded, so an old shape never reaches
 *   the state column's zod parse and never gets a chance to coerce into a
 *   wrong value. Treating a mismatch as `absent` instead would fold the next
 *   event onto a fresh accumulator and overwrite live state (ADR-098).
 * - **Read-your-writes.** See {@link READ_YOUR_WRITES_SETTINGS}.
 * - **A generated dedup read.** The `SELECT` is built once, at construction,
 *   from the table's declared sort key and version column — never hand-written
 *   per call site — and it is a point lookup on the full key, not a scanning
 *   dedup subquery, so the "never bind a movable column inside a dedup
 *   subquery" rule has nothing to violate here.
 *
 * **On the partition/TTL anchor.** `defineTable` requires every table to name
 * a `partition.column` that is frozen *and* platform-controlled (ADR-099), and
 * none of the six columns this store manages can be that column: the state,
 * delivery-seq and state-version columns aren't time columns at all, and the
 * merge-version (`writtenAt`) column is platform-controlled but not frozen —
 * it moves on every write, which is the property that makes it a version
 * column. So a real fold table declares a seventh column for this alone (an
 * `acceptedAt`-style anchor). This store detects it generically, by the same
 * `frozen`/`platformControlled` flags `defineTable` itself reads, and stamps
 * it with the write time on every write — it does not preserve the value from
 * a prior write. That is a deliberate, bounded simplification and not a
 * silent gap: preserving it exactly would need this store to read the anchor
 * back before every write (an extra round trip) purely to satisfy a column
 * this contract does not otherwise need, and ADR-099 itself carries several
 * tables with an imperfect anchor as acknowledged debt rather than blocking on
 * a perfect one. A caller that needs the anchor to be genuinely frozen across
 * writes must not reuse this store unmodified.
 */

import type {
  ReplaceStore,
  StateRead,
  StoreContext,
  StoredState,
} from "@langwatch/event-sourcing";
import type { ClickHouseClient } from "../client/clickhouseClient";
import type { ColumnDef, ColumnMap } from "../schema/columns";
import type { TableDefinition } from "../schema/defineTable";
import { createRowCodec, type AnyWireColumn, type WireCodec } from "../codec/rowCodec";

/**
 * Selects the column names of `Columns` whose declared value type is exactly
 * `T` — never a wider or narrower one (`ColumnDef<string>` does not match
 * `ColumnDef<string | null>` in either direction, because `decode`'s return
 * type and `encode`'s parameter type are checked in opposite variance).
 *
 * Exists so `ReplaceStoreArgs` can require, at the type level, that (for
 * example) the column named as `deliverySeqColumn` really does decode to
 * `bigint` — without this, a caller could point `deliverySeqColumn` at a
 * `String` column and only find out from a runtime encode failure.
 */
type ColumnKeyOfType<
  Columns extends ColumnMap,
  T,
> = {
  [K in keyof Columns]: Columns[K] extends ColumnDef<T> ? K : never;
}[keyof Columns] &
  string;

/**
 * Thrown at construction when a `createReplaceStore` call violates one of the
 * structural rules this adapter depends on — before any query is built or any
 * row is read, so a bad wiring fails a deploy rather than corrupting a fold's
 * state the first time it runs.
 */
export class ReplaceStoreConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReplaceStoreConfigurationError";
  }
}

/**
 * ClickHouse's mechanism for read-your-writes (ADR-098's contract, restated on
 * `ReplaceStore` itself): `select_sequential_consistency` makes the query
 * coordinator fetch the latest committed log position from Keeper before
 * executing, so a read that follows a completed write for the same key always
 * observes it, even when a load balancer routes the two calls to different
 * replicas. The cost is one extra Keeper round trip per read; accepted here
 * because a fold's read is a single row by key, not a scan, and the
 * alternative — a stale read silently restarting a fold from `init()` — is the
 * failure this store exists to rule out.
 */
const READ_YOUR_WRITES_SETTINGS = {
  select_sequential_consistency: 1,
} as const;

/** What `createReplaceStore` needs to wire a `ReplaceStore<State>` onto one table. */
export interface ReplaceStoreArgs<
  State,
  Columns extends ColumnMap,
> {
  readonly client: ClickHouseClient;
  /** Must declare `merge: replacing({ version })` (ADR-099). */
  readonly table: TableDefinition<Columns>;
  /** The column holding the tenant id. Must be part of `table.tenant`. */
  readonly tenantIdColumn: ColumnKeyOfType<Columns, string>;
  /**
   * The column holding the fold's key (the group key or aggregate id). Must be
   * part of `table.sortKey` — this store's read is a point lookup on the full
   * key, and a key column outside the sort key would make every read a scan.
   */
  readonly keyColumn: ColumnKeyOfType<Columns, string>;
  /** The column holding the fold's serialised state. */
  readonly stateColumn: ColumnKeyOfType<Columns, State>;
  /** The column holding the redelivery guard. Always a 64-bit column, decoded to `bigint` on the wire. */
  readonly deliverySeqColumn: ColumnKeyOfType<Columns, bigint>;
  /** The column holding the *state's* schema version — distinct from `table.merge.version`, the engine's own version column. */
  readonly stateVersionColumn: ColumnKeyOfType<Columns, string>;
  /**
   * The version this build writes and expects to read. A stored row whose
   * `stateVersionColumn` disagrees is reported as `undecodable`, never
   * decoded, and never treated as absent (ADR-098).
   */
  readonly expectedVersion: string;
  /** @default createRowCodec() */
  readonly codec?: WireCodec;
}

function requireColumn(
  columnNames: readonly string[],
  candidate: string,
  purpose: string,
  tableName: string,
): void {
  if (!columnNames.includes(candidate)) {
    throw new ReplaceStoreConfigurationError(
      `replace store for table "${tableName}": ${purpose} "${candidate}" is not one of the table's declared columns`,
    );
  }
}

/**
 * Builds a `ReplaceStore<State>` over one `defineTable` declaration.
 *
 * Validates its wiring eagerly: the table must declare `replacing`, every
 * named column must exist on the table, the tenant column must be one of the
 * table's declared tenant columns, the key column must be part of the sort
 * key, and every column the table declares must be accounted for — either one
 * of the five roles named above, the merge-version column, or a frozen,
 * platform-controlled anchor column this store can stamp automatically. Each
 * is a construction-time {@link ReplaceStoreConfigurationError} rather than a
 * fact discovered from a failing query in production.
 */
export function createReplaceStore<
  State,
  Columns extends ColumnMap,
>(args: ReplaceStoreArgs<State, Columns>): ReplaceStore<State> {
  const { client, table } = args;
  const codec = args.codec ?? createRowCodec();

  const merge = table.merge;
  if (merge.kind !== "replacing") {
    throw new ReplaceStoreConfigurationError(
      `replace store for table "${table.name}": table declares merge kind "${merge.kind}", ` +
        `but createReplaceStore only adopts a table declared with replacing({ version }) (ADR-099) — ` +
        `an aggregating or append table has no single "current" row to read back`,
    );
  }

  requireColumn(table.columnNames, args.tenantIdColumn, "tenantIdColumn", table.name);
  requireColumn(table.columnNames, args.keyColumn, "keyColumn", table.name);
  requireColumn(table.columnNames, args.stateColumn, "stateColumn", table.name);
  requireColumn(table.columnNames, args.deliverySeqColumn, "deliverySeqColumn", table.name);
  requireColumn(table.columnNames, args.stateVersionColumn, "stateVersionColumn", table.name);

  if (!table.tenant.includes(args.tenantIdColumn)) {
    throw new ReplaceStoreConfigurationError(
      `replace store for table "${table.name}": tenantIdColumn "${args.tenantIdColumn}" ` +
        `is not one of the table's declared tenant columns [${table.tenant.join(", ")}]`,
    );
  }

  if (!table.sortKey.includes(args.keyColumn)) {
    throw new ReplaceStoreConfigurationError(
      `replace store for table "${table.name}": keyColumn "${args.keyColumn}" is not part of ` +
        `the table's sort key [${table.sortKey.join(", ")}] — a read by this key would be a full scan`,
    );
  }

  const managedRoles = new Set<string>([
    args.tenantIdColumn,
    args.keyColumn,
    args.stateColumn,
    args.deliverySeqColumn,
    args.stateVersionColumn,
    merge.version,
  ]);
  if (managedRoles.size !== 6) {
    throw new ReplaceStoreConfigurationError(
      `replace store for table "${table.name}": tenantIdColumn, keyColumn, stateColumn, ` +
        `deliverySeqColumn, stateVersionColumn and the merge version column must all be distinct`,
    );
  }

  const columns = table.columns as ColumnMap;

  // Every column the table declares beyond the six managed roles must be a
  // frozen, platform-controlled anchor this store can stamp automatically
  // (see the module docblock) — anything else is a column this store has no
  // way to populate, and would fail the insert with an encode error on
  // `undefined` at the first write rather than at construction.
  const anchorColumnNames = table.columnNames.filter((name) => !managedRoles.has(name));
  for (const name of anchorColumnNames) {
    const column = columns[name]!;
    if (!(column.frozen && column.platformControlled)) {
      throw new ReplaceStoreConfigurationError(
        `replace store for table "${table.name}": column "${name}" is neither one of the ` +
          `roles this store manages (tenantId, key, state, deliverySeq, stateVersion, ` +
          `${merge.version}) nor a frozen, platform-controlled anchor column — this store has ` +
          `no value to write for it`,
      );
    }
  }

  const stateVersionCol = columns[args.stateVersionColumn]!;
  const deliverySeqCol = columns[args.deliverySeqColumn]!;
  const stateCol = columns[args.stateColumn]!;

  // Generated once, from the table's own declared columns — never a
  // hand-written string at the call site (ADR-099).
  const readSql =
    `SELECT ${args.stateVersionColumn}, ${args.deliverySeqColumn}, ${args.stateColumn} ` +
    `FROM ${table.name} ` +
    `WHERE ${args.tenantIdColumn} = {tenantId:String} AND ${args.keyColumn} = {key:String} ` +
    `ORDER BY ${merge.version} DESC LIMIT 1`;

  const readColumnNames = [args.stateVersionColumn, args.deliverySeqColumn, args.stateColumn];
  const readWireColumns: AnyWireColumn[] = [stateVersionCol, deliverySeqCol, stateCol];

  const writeWireColumns: AnyWireColumn[] = table.columnNames.map(
    (name) => columns[name]!,
  );

  /**
   * Decodes the stored state version from the first selected cell, without
   * touching the rest of the row.
   *
   * `readSql` names the version column first, so position 0 is it by
   * construction. Reading it on its own is what lets the version gate run
   * before the state payload is decoded (see the module docblock) — the
   * alternative, decoding the whole row first, hands a stale payload to the
   * current schema's parse, which is precisely the coercion this store exists
   * to avoid. A version cell that will not decode is not thrown either: it
   * comes back as `undefined` with the failure kept as the cause, because a
   * caller that cannot tell which version is stored still must not read the row
   * as absent.
   */
  function readStoredVersion(cell: unknown): {
    version: string | undefined;
    cause?: unknown;
  } {
    try {
      return { version: stateVersionCol.decode(cell) as string };
    } catch (cause) {
      return { version: undefined, cause };
    }
  }

  return {
    kind: "replace",

    async read(key: string, context: StoreContext): Promise<StateRead<State>> {
      const result = await client.query({
        tenantId: context.tenantId,
        sql: readSql,
        params: { tenantId: context.tenantId, key },
        settings: READ_YOUR_WRITES_SETTINGS,
      });

      const row = result.rows[0];
      if (!row) {
        return { kind: "absent" };
      }

      // The version gate runs first, on the version cell alone. The state
      // column is not decoded unless the gate passes: an old shape is not
      // guaranteed to parse safely under the current schema, and where it
      // happens to parse it means something the current fold does not intend
      // (ADR-098).
      const { version: storedVersion, cause: versionCause } = readStoredVersion(row[0]);
      if (storedVersion !== args.expectedVersion) {
        return versionCause === undefined
          ? { kind: "undecodable", storedVersion }
          : { kind: "undecodable", storedVersion, cause: versionCause };
      }

      let decoded: Record<string, unknown>;
      try {
        const [decodedRow] = codec.decodeRows<Record<string, unknown>>({
          columns: readWireColumns,
          columnNames: readColumnNames,
          header: result.header,
          rows: [row],
        });
        // `decodeRows` returns one entry per input row or throws — this can
        // only be reached for a zero-length result, which a one-row input
        // never produces.
        if (!decodedRow) {
          return { kind: "undecodable", storedVersion };
        }
        decoded = decodedRow;
      } catch (cause) {
        return { kind: "undecodable", storedVersion, cause };
      }

      const deliverySeq = decoded[args.deliverySeqColumn] as bigint;
      const state = decoded[args.stateColumn] as State;

      return {
        kind: "found",
        stored: {
          state,
          deliverySeq: Number(deliverySeq),
          version: storedVersion,
        },
      };
    },

    async write(
      key: string,
      stored: StoredState<State>,
      context: StoreContext,
    ): Promise<void> {
      const now = new Date();
      const row: Record<string, unknown> = {
        [args.tenantIdColumn]: context.tenantId,
        [args.keyColumn]: key,
        [args.stateColumn]: stored.state,
        [args.deliverySeqColumn]: BigInt(stored.deliverySeq),
        [args.stateVersionColumn]: stored.version,
        [merge.version]: now,
      };
      for (const name of anchorColumnNames) {
        row[name] = now;
      }

      const encodedRows = codec.encodeRows({
        columns: writeWireColumns,
        columnNames: table.columnNames,
        rows: [row],
      });

      // Durable-first by construction: `client.insert` only resolves once
      // `wait_for_async_insert` confirms the row landed (ADR-099, ADR-104).
      await client.insert({
        tenantId: context.tenantId,
        table: table.name,
        rows: encodedRows,
        columns: table.columnNames,
        target: { kind: "replacing" },
      });
    },
  };
}
