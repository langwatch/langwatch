/**
 * A ClickHouse table declared once by its owner (ADR-202, "Tables are typed descriptors"): its
 * columns and their types, its tenant, time and version columns and its sort key. A read names a
 * column only through the descriptor, so a column it does not declare does not compile.
 */
import type { TenantScopeTimeColumn } from "@langwatch/clickhouse-markers";

import { type ColumnRef, type ColumnType, columnRef, isExpression, refOf } from "./expression.ts";

export type ColumnsSpec = Readonly<Record<string, ColumnType<unknown>>>;
type ValueOfColumn<C> = C extends ColumnType<infer Value> ? Value : never;

/**
 * A stored tenant table, a server-metadata system table, a system table only the system identity
 * reads, a read used as a table, bound rows.
 */
export type TableKind = "tenant" | "system" | "systemIdentity" | "derived" | "rows";

/** The descriptor's facts the builder renders from, apart from its typed columns. */
export type ClickHouseTableFacts = {
  readonly kind: TableKind;
  /** The name a read refers to the table by: the table's own name, or an alias. */
  readonly name: string;
  /** The stored table read; equal to `name` unless aliased. */
  readonly stored: string;
  readonly tenantColumn: string;
  readonly timeColumn: TenantScopeTimeColumn | undefined;
  readonly versionColumn: string | undefined;
  readonly sortKey: readonly string[];
  readonly columns: readonly string[];
};

export type ClickHouseTable<
  Name extends string,
  Columns extends ColumnsSpec,
  Kind extends TableKind = "tenant",
> = {
  readonly $table: ClickHouseTableFacts & { readonly name: Name; readonly kind: Kind };
} & {
  readonly [Column in keyof Columns & string]: ColumnRef<
    Name,
    Column,
    ValueOfColumn<Columns[Column]>
  >;
};

/** Identifiers the builder writes into text: a descriptor's names and a read's aliases. */
export const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** A descriptor's column name: an identifier, or a nested column's `Parent.Member`. */
export const COLUMN_NAME = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/;

function refsOf({ name, columns }: { name: string; columns: ColumnsSpec }) {
  return Object.fromEntries(
    Object.entries(columns).map(([each, type]) => [
      each,
      columnRef({ table: name, name: each, type }),
    ]),
  );
}

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
  if (!IDENTIFIER.test(name)) throw new Error(`"${name}" is not a plain identifier`);
  for (const each of names) {
    if (!COLUMN_NAME.test(each)) throw new Error(`"${each}" is not a plain or nested column name`);
  }
  const facts = {
    kind: "tenant" as const,
    name,
    stored: name,
    tenantColumn,
    timeColumn,
    versionColumn,
    sortKey,
    columns: names,
  };
  return { ...refsOf({ name, columns }), $table: facts } as ClickHouseTable<Name, Columns>;
}

/** A second name for a tenant table, for a self-join: its columns refer to the alias. */
export function aliasOf<
  Name extends string,
  Columns extends ColumnsSpec,
  const Alias extends string,
>({
  table,
  alias,
}: {
  table: ClickHouseTable<Name, Columns>;
  alias: Alias;
}): ClickHouseTable<Alias, Columns> {
  if (!IDENTIFIER.test(alias)) throw new Error(`"${alias}" is not a plain identifier`);
  const facts = { ...table.$table, name: alias };
  const refs = Object.fromEntries(
    Object.entries(table).flatMap(([each, ref]) =>
      isExpression(ref)
        ? [[each, refOf({ table: alias, stored: facts.stored, name: each, binding: ref.binding })]]
        : [],
    ),
  );
  return { ...refs, $table: facts } as ClickHouseTable<Alias, Columns>;
}

/** The system tables a server-metadata read may name, and nothing else (ADR-202). */
export const SERVER_METADATA_TABLES = [
  "system.columns",
  "system.replicas",
  "system.server_settings",
] as const;
export type ServerMetadataTableName = (typeof SERVER_METADATA_TABLES)[number];

/**
 * The system tables only an all-tenants read names, on the system identity (ADR-202, "What needs a
 * policy-exempt identity": storage footprint, retention). On 26.8 the reader sees parts and tables
 * of granted tables only, and a mutation's command text names its tenants.
 */
export const SYSTEM_IDENTITY_TABLES = [
  "system.backup_log",
  "system.disks",
  "system.mutations",
  "system.parts",
  "system.tables",
] as const;
export type SystemIdentityTableName = (typeof SYSTEM_IDENTITY_TABLES)[number];

function systemFacts<Kind extends "system" | "systemIdentity", Name extends string>({
  kind,
  name,
  columns,
}: {
  kind: Kind;
  name: Name;
  columns: ColumnsSpec;
}) {
  return {
    kind,
    name,
    stored: name,
    tenantColumn: "",
    timeColumn: undefined,
    versionColumn: undefined,
    sortKey: [],
    columns: Object.keys(columns),
  };
}

/** A system table on the allow-list; it holds no tenant rows, so no tenant column is declared. */
export function systemTable<
  const Name extends ServerMetadataTableName,
  const Columns extends ColumnsSpec,
>({ name, columns }: { name: Name; columns: Columns }): ClickHouseTable<Name, Columns, "system"> {
  const facts = systemFacts({ kind: "system", name, columns });
  return { ...refsOf({ name, columns }), $table: facts } as ClickHouseTable<
    Name,
    Columns,
    "system"
  >;
}

/** A system table only `tenantScope.allTenants` reads; never the reader, never server metadata. */
export function systemIdentityTable<
  const Name extends SystemIdentityTableName,
  const Columns extends ColumnsSpec,
>({
  name,
  columns,
}: {
  name: Name;
  columns: Columns;
}): ClickHouseTable<Name, Columns, "systemIdentity"> {
  const facts = systemFacts({ kind: "systemIdentity", name, columns });
  return { ...refsOf({ name, columns }), $table: facts } as ClickHouseTable<
    Name,
    Columns,
    "systemIdentity"
  >;
}
