/**
 * The LangWatchQL catalogue: which permissions read each table and column. Every source column
 * is exposed, renamed or omitted explicitly, so a new column is a compile error until decided.
 * @see specs/lwql/catalogue-grants.feature
 */

import type { AuthzPermission } from "@langwatch/authz-contract";

import type { LwqlClickHouseRows } from "./lwql-columns-manifest.generated.ts";
import type { ColumnsManifest } from "./lwql-columns-manifest.rules.ts";
import type { LwqlPrismaRows } from "./lwql-prisma-manifest.generated.ts";
import type { PrismaManifest } from "./lwql-prisma-schema.rules.ts";

type Permissions = readonly [AuthzPermission, ...AuthzPermission[]];

/** Every permission, or at least one of them; never empty, so an access cannot fail open. */
export type LwqlAccess = Readonly<{ allOf: Permissions }> | Readonly<{ anyOf: Permissions }>;

/** Captured content: the project's data-privacy policy decides it, not a grant. */
export type LwqlContent = "input" | "output";

/** A column carrying both contents is readable only by a caller who may see both. */
type LwqlGate = Readonly<{
  access?: LwqlAccess;
  content?: LwqlContent | readonly ["input", "output"];
}>;

/**
 * One exposed name: `"inherit"` (the source column of that name, table access only), `"omit"`
 * (exposed nowhere), or a gate, with `source` when it reads a column of another name.
 */
export type LwqlColumnEntry<Column extends string = string> =
  | "inherit"
  | "omit"
  | (LwqlGate & Readonly<{ source?: Column }>);

/** Every ClickHouse table and Prisma model a catalogue table may read, by name. */
export type LwqlSourceRows = LwqlClickHouseRows & LwqlPrismaRows;
export type LwqlSourceTable = keyof LwqlSourceRows;
type SourceColumn<Table extends LwqlSourceTable> = keyof LwqlSourceRows[Table] & string;

type Columns<Column extends string> = Readonly<Record<string, LwqlColumnEntry<Column>>>;
type SourceOf<Entry> = Entry extends Readonly<{ source: infer Source }> ? Source : never;
type Sources<C> = { [K in keyof C]: SourceOf<C[K]> }[keyof C];
type Omitted<C> = { [K in keyof C]: C[K] extends "omit" ? K : never }[keyof C];

/**
 * What `columns` must also be: a source column's own name takes no `source`; any other name
 * needs one, never an omitted column; and every source column no entry reads needs an entry.
 */
type Complete<Column extends string, C> = {
  readonly [K in keyof C]: K extends Column
    ? "inherit" | "omit" | (LwqlGate & Readonly<{ source?: never }>)
    : LwqlGate & Readonly<{ source: Exclude<Column, Omitted<C>> }>;
} & { readonly [K in Exclude<Column, keyof C | Sources<C>>]: LwqlColumnEntry<Column> };

/** One catalogue table: its source, the access its every column needs, and its columns. */
export type LwqlTableCatalogue = Readonly<{
  sourceTable: LwqlSourceTable;
  access: LwqlAccess;
  columns: Columns<string>;
}>;

/** The whole catalogue, keyed by the view name a statement uses. */
export type LwqlCatalogue = Readonly<Record<string, LwqlTableCatalogue>>;

/** One table, checked for completeness against its source's generated row type. */
export function defineTableCatalogue<
  const Table extends LwqlSourceTable,
  const C extends Columns<SourceColumn<Table>>,
>(entry: {
  sourceTable: Table;
  access: LwqlAccess;
  columns: C & Complete<SourceColumn<Table>, C>;
}): LwqlTableCatalogue {
  return entry;
}

/** The catalogue, its view names kept literal. */
export function defineLwqlCatalog<const Catalogue extends LwqlCatalogue>(
  catalogue: Catalogue,
): Catalogue {
  return catalogue;
}

/** A column a statement may name, with the source column it reads and its own gates. */
export type LwqlExposedColumn = LwqlGate & Readonly<{ name: string; source: string }>;

/** The columns a table exposes, in declaration order; an omitted column is not among them. */
export function exposedCatalogueColumns({
  table,
}: {
  table: LwqlTableCatalogue;
}): readonly LwqlExposedColumn[] {
  return Object.entries(table.columns).flatMap(([name, entry]): LwqlExposedColumn[] => {
    if (entry === "omit") return [];
    if (entry === "inherit") return [{ name, source: name }];
    const { source = name, ...gate } = entry;
    return [{ name, source, ...gate }];
  });
}

/** Whether a held permission set satisfies an access: every one of allOf, or one of anyOf. */
export function isAccessHeld({
  access,
  held,
}: {
  access: LwqlAccess;
  held: ReadonlySet<string>;
}): boolean {
  return "allOf" in access
    ? access.allOf.every((permission) => held.has(permission))
    : access.anyOf.some((permission) => held.has(permission));
}

/** Every permission a catalogue names, on a table or a column, once each, sorted. */
export function cataloguePermissions({
  catalog,
}: {
  catalog: LwqlCatalogue;
}): readonly AuthzPermission[] {
  const permissionsOf = (access: LwqlAccess | undefined): readonly AuthzPermission[] => {
    if (access === undefined) return [];
    return "allOf" in access ? access.allOf : access.anyOf;
  };
  const named = Object.values(catalog).flatMap((table) => [
    ...permissionsOf(table.access),
    ...exposedCatalogueColumns({ table }).flatMap((column) => permissionsOf(column.access)),
  ]);
  return [...new Set(named)].toSorted();
}

type RowsTable = Readonly<{
  name: string;
  columns: readonly Readonly<{ name: string; type: string }>[];
}>;

function propertyKey(name: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name);
}

function rowsSource({
  typeName,
  generator,
  tables,
}: {
  typeName: string;
  generator: string;
  tables: readonly RowsTable[];
}): string {
  const body = tables.map((table) => {
    const columns = table.columns.map(
      (column) => `    readonly ${propertyKey(column.name)}: ${JSON.stringify(column.type)};\n`,
    );
    return `  readonly ${propertyKey(table.name)}: {\n${columns.join("")}  };\n`;
  });
  return (
    `// Generated by ${generator}; do not edit. Regenerate with it.\n\n` +
    `/** Each source's column names and types: the row types lwql-catalogue.rules.ts checks. */\n` +
    `export interface ${typeName} {\n${body.join("")}}\n`
  );
}

/** `lwql-columns-manifest.generated.ts`, rendered from the ClickHouse columns manifest. */
export function renderClickHouseRows({ manifest }: { manifest: ColumnsManifest }): string {
  return rowsSource({
    typeName: "LwqlClickHouseRows",
    generator: "scripts/generate-lwql-columns-manifest.ts",
    tables: manifest.tables,
  });
}

/** `lwql-prisma-manifest.generated.ts`: each model's column-bearing fields, relations excluded. */
export function renderPrismaRows({ manifest }: { manifest: PrismaManifest }): string {
  return rowsSource({
    typeName: "LwqlPrismaRows",
    generator: "scripts/generate-lwql-prisma-manifest.ts",
    tables: manifest.models.map((model) => ({
      name: model.name,
      columns: model.fields
        .filter((field) => field.kind !== "relation")
        .map((field) => ({
          name: field.name,
          type: `${field.type}${field.isList ? "[]" : ""}${field.isOptional ? "?" : ""}`,
        })),
    })),
  });
}

/** The exemplar table (P1b moves it beside the view catalogue); ADR-082 grants stay below it. */
export const LWQL_TRACES_CATALOGUE = defineTableCatalogue({
  sourceTable: "trace_summaries",
  access: { allOf: ["analytics:view", "traces:view"] },
  columns: {
    ProjectionId: "omit",
    TenantId: "inherit",
    TraceId: "inherit",
    Version: "omit",
    Attributes: "inherit",
    OccurredAt: "inherit",
    CreatedAt: "omit",
    UpdatedAt: "inherit",
    ComputedIOSchemaVersion: "omit",
    CapturedInput: { source: "ComputedInput", content: "input" },
    CapturedOutput: { source: "ComputedOutput", content: "output" },
    TimeToFirstTokenMs: "inherit",
    TimeToLastTokenMs: "inherit",
    TotalDurationMs: "inherit",
    TokensPerSecond: "inherit",
    SpanCount: "inherit",
    ContainsErrorStatus: "inherit",
    ContainsOKStatus: "inherit",
    ErrorMessage: "omit",
    Models: "inherit",
    TotalCost: { access: { allOf: ["cost:view"] } },
    NonBilledCost: "omit",
    TokensEstimated: "inherit",
    TotalPromptTokenCount: "inherit",
    TotalCompletionTokenCount: "inherit",
    OutputFromRootSpan: "omit",
    OutputSpanEndTimeMs: "omit",
    BlockedByGuardrail: "omit",
    SatisfactionScore: "inherit",
    TopicId: "inherit",
    SubTopicId: "inherit",
    HasAnnotation: "omit",
    AnnotationIds: "omit",
    LastEventOccurredAt: "omit",
    TraceName: "inherit",
    RootSpanType: "omit",
    ContainsAi: "omit",
    ContainsPrompt: "inherit",
    SelectedPromptId: "inherit",
    SelectedPromptSpanId: "omit",
    LastUsedPromptId: "inherit",
    LastUsedPromptVersionNumber: "inherit",
    LastUsedPromptVersionId: "inherit",
    LastUsedPromptSpanId: "omit",
    SourceType: "inherit",
    SourceId: "omit",
    _retention_days: "omit",
    _size_bytes: "omit",
    EarliestSpanStartMs: "omit",
  },
});
