/**
 * A ClickHouse table declared once by its owner (ADR-202, "Tables are typed descriptors"): its
 * columns and their types, its tenant, time and version columns and its sort key. A read names a
 * column only through the descriptor, so a column it does not declare does not compile.
 */
import type { TenantScopeTimeColumn } from "@langwatch/clickhouse-markers";

import { type ColumnRef, type ColumnType, columnRef } from "./expression.ts";

export type ColumnsSpec = Readonly<Record<string, ColumnType<unknown>>>;
type ValueOfColumn<C> = C extends ColumnType<infer Value> ? Value : never;

/** The descriptor's facts the builder renders from, apart from its typed columns. */
export type ClickHouseTableFacts = {
  readonly name: string;
  readonly tenantColumn: string;
  readonly timeColumn: TenantScopeTimeColumn | undefined;
  readonly versionColumn: string | undefined;
  readonly sortKey: readonly string[];
  readonly columns: readonly string[];
};

export type ClickHouseTable<Name extends string, Columns extends ColumnsSpec> = {
  readonly $table: ClickHouseTableFacts & { readonly name: Name };
} & {
  readonly [Column in keyof Columns & string]: ColumnRef<
    Name,
    Column,
    ValueOfColumn<Columns[Column]>
  >;
};

/** Identifiers the builder writes into text: a descriptor's names and a read's aliases. */
export const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function defineClickHouseTable<
  const Name extends string,
  const Columns extends ColumnsSpec,
>({
  name,
  tenantColumn,
  timeColumn,
  versionColumn,
  sortKey,
  columns,
}: {
  name: Name;
  tenantColumn: keyof Columns & string;
  timeColumn?: Extract<keyof Columns, TenantScopeTimeColumn>;
  versionColumn?: keyof Columns & string;
  sortKey: readonly (keyof Columns & string)[];
  columns: Columns;
}): ClickHouseTable<Name, Columns> {
  const names = Object.keys(columns);
  for (const identifier of [name, ...names]) {
    if (!IDENTIFIER.test(identifier)) throw new Error(`"${identifier}" is not a plain identifier`);
  }
  const refs = Object.fromEntries(
    Object.entries(columns).map(([column, type]) => [
      column,
      columnRef({ table: name, name: column, type }),
    ]),
  );
  const facts = { name, tenantColumn, timeColumn, versionColumn, sortKey, columns: names };
  return { ...refs, $table: facts } as ClickHouseTable<Name, Columns>;
}
