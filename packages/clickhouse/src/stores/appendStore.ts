/**
 * Implements `@langwatch/event-sourcing`'s `AppendStore<Record>` contract on a
 * `defineTable` declaration whose merge strategy is `append()` or
 * `replacing({ version })` with a per-record-identity sort key (ADR-099,
 * ADR-102). Both survive a duplicate write the same way — the row collapses
 * at merge rather than colliding as two live rows — which is exactly why
 * ADR-104 marks both retryable and this module treats them identically apart
 * from the {@link WriteTarget} it reports.
 *
 * `writeBatch` is the only path: one `client.insert` call per delivery, never
 * one per record. A `map` projection's whole delivery is flattened to records
 * before it reaches a store (`mapExecutor.ts`); this module's job is only to
 * turn that batch into one wire insert, because one write per record is what
 * creates a part per record in a column store, and that shape has already
 * caused an incident (ADR-099).
 */

import type { AppendStore, BatchContext } from "@langwatch/event-sourcing";
import type { ClickHouseClient, WriteTarget } from "../client/clickhouseClient";
import type { ColumnMap } from "../schema/columns";
import type { TableDefinition, TableRow } from "../schema/defineTable";
import { createRowCodec, type AnyWireColumn, type WireCodec } from "../codec/rowCodec";

/**
 * Thrown at construction when a `clickhouseAppend` call targets a table this
 * adapter cannot serve — before any record is ever written.
 */
export class AppendStoreConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppendStoreConfigurationError";
  }
}

/** What `clickhouseAppend` needs to wire an `AppendStore<Rec>` onto one table. */
export interface ClickHouseAppendArgs<
  Rec,
  Columns extends ColumnMap,
> {
  readonly client: ClickHouseClient;
  /** Must declare `merge: append()` or `merge: replacing({ version })` (ADR-099). */
  readonly table: TableDefinition<Columns>;
  /**
   * Maps one domain record to the table's full row shape. Pure and
   * synchronous by contract — a map projection's own mapping function is the
   * place for anything that can fail or needs to look elsewhere; this
   * function only reshapes what a projection already produced, plus the
   * batch's shared tenant context.
   */
  readonly toRow: (record: Rec, context: BatchContext) => TableRow<Columns>;
  /** @default createRowCodec() */
  readonly codec?: WireCodec;
}

/**
 * Builds an `AppendStore<Rec>` over one `defineTable` declaration.
 *
 * Refuses an `aggregating` table outright: that merge strategy is not
 * idempotent under redelivery (a retried or replayed batch changes the
 * answer), so it needs the caller to state an idempotency story, which is
 * exactly what `MergeStore` — not this adapter — requires at the type level
 * (ADR-099).
 */
export function clickhouseAppend<
  Rec,
  Columns extends ColumnMap,
>(args: ClickHouseAppendArgs<Rec, Columns>): AppendStore<Rec> {
  const { client, table, toRow } = args;
  const codec = args.codec ?? createRowCodec();

  const merge = table.merge;
  if (merge.kind === "aggregating") {
    throw new AppendStoreConfigurationError(
      `append store for table "${table.name}": table declares merge kind "aggregating", ` +
        `but clickhouseAppend only adopts "append" or "replacing" tables (ADR-099) — ` +
        `an aggregating table combines rows on merge, which is not idempotent under ` +
        `redelivery, and needs a declared idempotency story a MergeStore adapter enforces`,
    );
  }

  // Both remaining kinds collapse a duplicate row at merge time — `append()`
  // only when its sort key already carries a per-record identity, which
  // `replacing({ version })` always does structurally (ADR-099, ADR-104).
  // `defineTable` does not (and cannot) tell the two `append()` shapes apart
  // from each other, so a plain `MergeTree` table declared via `append()` is
  // reported as not retry-safe here, matching the conservative default ADR-104
  // §2 assigns it.
  const writeTarget: WriteTarget =
    merge.kind === "append"
      ? { kind: "append", perRecordIdentity: false }
      : { kind: "replacing" };

  const wireColumns: readonly AnyWireColumn[] = table.wireColumns;

  return {
    kind: "append",

    async writeBatch(records: readonly Rec[], context: BatchContext): Promise<void> {
      if (records.length === 0) return;

      const rows = records.map((record) => toRow(record, context));
      const encodedRows = codec.encodeRows({
        columns: wireColumns,
        columnNames: table.columnNames,
        rows,
      });

      // Durable-first by construction: `client.insert` only resolves once
      // `wait_for_async_insert` confirms the block landed (ADR-099, ADR-104).
      await client.insert({
        tenantId: context.tenantId,
        table: table.name,
        rows: encodedRows,
        columns: table.columnNames,
        target: writeTarget,
      });
    },
  };
}
