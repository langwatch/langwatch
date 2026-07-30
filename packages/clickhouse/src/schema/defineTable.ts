import { z } from "zod";
import type { AnyColumnDef, ColumnDef, ColumnMap } from "./columns.js";

/**
 * How a redelivered write to an `aggregating` table avoids double counting.
 * Named once here rather than spelled out at each of its uses, so the set of
 * answers a caller may give cannot drift between the strategy, the builder that
 * takes it, and the store contract in `@langwatch/event-sourcing` that mirrors
 * it (ADR-099).
 */
export type MergeIdempotency = "upstream-exactly-once" | "whole-bucket-replace";

/**
 * The three store kinds of ADR-099, discriminated so the merge strategy a
 * table declares changes which query methods exist at the type level: a
 * `replacing` table's reads dedup by default, an `aggregating` table has no
 * raw `.select()`, and an `append` table has no dedup method at all. Without
 * this type the engine contract stays a convention a reviewer has to
 * remember rather than a compile error the query builder enforces.
 */
export type MergeStrategy =
  | { readonly kind: "replacing"; readonly version: string }
  | {
      readonly kind: "aggregating";
      readonly idempotency: MergeIdempotency;
    }
  | { readonly kind: "append" };

/**
 * Declares a `ReplacingMergeTree` table. `version` must name a column whose
 * time role is `writtenAt` — `defineTable` rejects anything else, because a
 * version that does not move on every write cannot break a tie between two
 * versions of the same row (ADR-099).
 */
export function replacing(args: { readonly version: string }): MergeStrategy {
  return { kind: "replacing", version: args.version };
}

/**
 * Declares an `AggregatingMergeTree` table. `idempotency` is mandatory,
 * never inferred, because `map` + `merge` is the one projection/store
 * combination where a redelivered event double counts (ADR-099) — the caller
 * must state how a retry avoids that rather than the builder assuming it
 * does.
 */
export function aggregating(args: {
  readonly idempotency: MergeIdempotency;
}): MergeStrategy {
  return { kind: "aggregating", idempotency: args.idempotency };
}

/**
 * Declares a plain `MergeTree`, or a `ReplacingMergeTree` whose sort key
 * already carries a per-record identity so collapsing two rows never
 * discards data. Both rows survive a collision; there is no version to elect
 * and no dedup method exists for this kind (ADR-099).
 */
export function append(): MergeStrategy {
  return { kind: "append" };
}

/** The row shape a table's columns imply, derived rather than declared. */
export type TableRow<Columns extends ColumnMap> = {
  [K in keyof Columns]: Columns[K] extends ColumnDef<infer T> ? T : never;
};

/**
 * A named exemption from one of `defineTable`'s structural-role checks, for
 * a deployed table whose partition column, TTL anchor or `ReplacingMergeTree`
 * version genuinely fails the rule and cannot be re-keyed without a migration
 * (ADR-099 "Known debt this does not fix yet"). `column` still carries its
 * TRUE role — declaring a false one to slip past the guard is the defect this
 * exists to replace — and `reason` is the one sentence a reviewer reads to
 * know why. Scoped to one column: a table with two violating columns needs
 * two entries, never a single table-wide switch.
 */
export interface StructuralDebt {
  readonly column: string;
  readonly reason: string;
}

/** The facts a drift test compares against migration DDL (ADR-099). */
export interface TableDescription {
  readonly name: string;
  readonly merge: MergeStrategy;
  readonly sortKey: readonly string[];
  readonly partition: { readonly by: string; readonly column: string };
  readonly tenant: readonly string[];
  readonly ttl: { readonly anchor: string } | undefined;
  readonly columnNames: readonly string[];
  readonly columnTypes: Readonly<Record<string, string>>;
}

export interface TableDefinitionArgs<Columns extends ColumnMap> {
  readonly name: string;
  readonly merge: MergeStrategy;
  readonly sortKey: readonly (keyof Columns & string)[];
  readonly partition: {
    readonly by: string;
    readonly column: keyof Columns & string;
  };
  readonly tenant: readonly (keyof Columns & string)[];
  readonly ttl?: { readonly anchor: keyof Columns & string };
  readonly columns: Columns;
  /**
   * Per-column exemptions from the frozen-and-platform-controlled rule and
   * the writtenAt version rule (see `StructuralDebt`). Every check this
   * bypasses still runs, unweakened, for every column not named here.
   */
  readonly structuralDebt?: readonly StructuralDebt[];
}

export interface TableDefinition<Columns extends ColumnMap>
  extends TableDefinitionArgs<Columns> {
  /** Declaration order — the codec is positional, so order is the contract. */
  readonly columnNames: readonly (keyof Columns & string)[];
  /** A zod schema for the row shape, decoded through each column's schema. */
  readonly rowSchema: z.ZodType<TableRow<Columns>>;
  /**
   * `columns`, in `columnNames` order, as the codec wants them —
   * `createRowCodec().encodeRows`/`decodeRows` take a positional array, not
   * the name-keyed `columns` map. Computed once here rather than by every
   * store adapter and repository re-deriving it from `columnNames` and
   * `columns`.
   */
  readonly wireColumns: readonly AnyColumnDef[];
  describe(): TableDescription;
}

/**
 * Thrown when a `defineTable` declaration violates one of ADR-099's
 * structural rules. Always thrown at construction — before any query is
 * built or any row is read — so a bad declaration fails a deploy rather than
 * silently returning a stale or double-counted row.
 */
export class TableDefinitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TableDefinitionError";
  }
}

/**
 * One `defineTable` call per table is the single source of truth for its
 * shape, its wire codec inputs and the query API it will expose (ADR-099).
 * Every rule enforced here exists because the schema-catalogue it replaces
 * declared the same facts without checking them: `partitionColumnMayMove`,
 * `partitionColumnStability` and the version/tenant/sort-key conventions all
 * had zero runtime callers, and the cost was `evaluation_analytics`'s dedup
 * subquery silently dropping the true latest row. `defineTable` makes each of
 * those a construction-time error instead of a property nobody consulted.
 */
export function defineTable<Columns extends ColumnMap>(
  def: TableDefinitionArgs<Columns>,
): TableDefinition<Columns> {
  const fail = (rule: string): never => {
    throw new TableDefinitionError(`table "${def.name}" ${rule}`);
  };

  const columnsByName = def.columns as Record<string, AnyColumnDef | undefined>;
  const columnNames = Object.keys(def.columns) as (keyof Columns & string)[];
  // `Object.values` enumerates in the same order as `Object.keys` for the
  // same object (both follow string-key insertion order), so this lines up
  // with `columnNames` positionally without re-indexing by name.
  const wireColumns = Object.values(def.columns) as AnyColumnDef[];

  if (def.sortKey.length === 0) {
    fail("declares an empty sort key — every table needs an ordering column");
  }
  for (const key of def.sortKey) {
    if (!(key in def.columns)) {
      fail(`sort key names undeclared column "${key}"`);
    }
  }

  if (def.tenant.length === 0) {
    fail("declares no tenant columns — every table is tenant-scoped");
  }
  for (const key of def.tenant) {
    if (!(key in def.columns)) {
      fail(`tenant list names undeclared column "${key}"`);
    }
  }

  const structuralDebt = def.structuralDebt ?? [];
  const structuralDebtByColumn = new Map<string, StructuralDebt>();
  for (const entry of structuralDebt) {
    if (!(entry.column in def.columns)) {
      fail(`structural debt names undeclared column "${entry.column}"`);
    }
    if (entry.reason.trim().length === 0) {
      fail(`structural debt on column "${entry.column}" needs a reason`);
    }
    if (structuralDebtByColumn.has(entry.column)) {
      fail(`structural debt on column "${entry.column}" is declared twice`);
    }
    structuralDebtByColumn.set(entry.column, entry);
  }
  const usedStructuralDebtColumns = new Set<string>();

  const requireFrozenAndPlatformControlled = (
    columnName: string,
    purpose: string,
  ): void => {
    const column = columnsByName[columnName];
    if (!column) {
      fail(`${purpose} names undeclared column "${columnName}"`);
      return;
    }
    if (column.frozen && column.platformControlled) return;
    if (structuralDebtByColumn.has(columnName)) {
      usedStructuralDebtColumns.add(columnName);
      return;
    }
    fail(
      `${purpose} "${columnName}" is not frozen and platform-controlled ` +
        `(the acceptedAt role) — occurredAt is customer-supplied and moves, ` +
        `so using it here would make part count, partition spread and ` +
        `retention untrusted inputs`,
    );
  };

  requireFrozenAndPlatformControlled(def.partition.column, "partition column");

  if (def.ttl) {
    requireFrozenAndPlatformControlled(def.ttl.anchor, "TTL anchor");
  }

  if (def.merge.kind === "replacing") {
    const versionColumnName = def.merge.version;
    const versionColumn = columnsByName[versionColumnName];
    if (!versionColumn) {
      fail(`replacing version names undeclared column "${versionColumnName}"`);
    } else if (versionColumn.timeRole !== "writtenAt") {
      if (structuralDebtByColumn.has(versionColumnName)) {
        usedStructuralDebtColumns.add(versionColumnName);
      } else {
        fail(
          `replacing version column "${versionColumnName}" is not a writtenAt ` +
            `column — a version that does not move on every write cannot select ` +
            `a version on collision`,
        );
      }
    }
  }

  for (const entry of structuralDebt) {
    if (!usedStructuralDebtColumns.has(entry.column)) {
      fail(
        `structural debt names column "${entry.column}", which is not this ` +
          `table's partition column, TTL anchor or replacing version — remove ` +
          `the unused exemption`,
      );
    }
  }

  const rowSchema = z.object(
    Object.fromEntries(
      columnNames.map((name) => [name, columnsByName[name]!.schema]),
    ),
  ) as unknown as z.ZodType<TableRow<Columns>>;

  const describe = (): TableDescription => ({
    name: def.name,
    merge: def.merge,
    sortKey: def.sortKey,
    partition: def.partition,
    tenant: def.tenant,
    ttl: def.ttl,
    columnNames,
    columnTypes: Object.fromEntries(
      columnNames.map((name) => [name, columnsByName[name]!.chType]),
    ),
  });

  return {
    ...def,
    columnNames,
    wireColumns,
    rowSchema,
    describe,
  };
}
