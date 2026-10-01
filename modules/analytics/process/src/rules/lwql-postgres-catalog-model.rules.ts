/**
 * Builds the PostgreSQL-resident half of the LangWatchQL catalog from a catalogue table (which
 * columns, under which names and gates) and the model's Prisma manifest entry (types, tenant
 * scope, descriptions), one {@link defineCatalogModel} call per view.
 */

import type { AuthzPermission } from "@langwatch/authorization";

import type {
  LangWatchQLColumnUnit,
  LangWatchQLViewColumn,
  LangWatchQLViewDefinition,
} from "../services/langwatch-ql-catalog-shapes.service.ts";
import type { LwqlAccess, LwqlColumnEntry, LwqlTableCatalogue } from "./lwql-catalogue.rules.ts";
import { LWQL_PRISMA_MANIFEST, prismaManifestModel } from "./lwql-prisma-manifest.rules.ts";
import type { PrismaField, PrismaManifest, PrismaModel } from "./lwql-prisma-schema.rules.ts";
import {
  organizationTenantPath,
  type PostgresApprovedViewJoin,
  parentTenantPath,
  projectTenantPath,
  teamTenantPath,
} from "./lwql-tenant-paths.rules.ts";

/** How far behind the application's writes a PostgreSQL-resident view can be. */
const LIVE_FRESHNESS = "live — read from PostgreSQL at query time";

/** The name every view exposes the owning project under. */
const TENANT_COLUMN = "TenantId";

/** The three direct tenant columns, narrowest first. */
const TENANT_COLUMNS = ["projectId", "teamId", "organizationId"] as const;

/** A derived view, plus every column its catalogue table omits and why. */
export interface DerivedPostgresView extends LangWatchQLViewDefinition {
  readonly skipColumns: Readonly<Record<string, string>>;
}

/** One column's tenant scope, and the join chain that reaches its project. */
export interface TenantScope {
  readonly kind: "project" | "team" | "organization" | "parent";
  /** Column read on the last alias of {@link tenantPath} to yield `TenantId`. */
  readonly column: string;
  /** The join chain to the relation carrying the project (empty for project). */
  readonly tenantPath: readonly PostgresApprovedViewJoin[];
  /**
   * Field of *this* model consumed to produce `TenantId`, so it is not also
   * exposed under its own name. Absent for a parent scope, whose foreign key
   * stays an ordinary opaque-id column.
   */
  readonly consumedField?: string;
}

/** Everything one model's override can set, all optional. */
export interface PostgresDatasetOverride {
  readonly description?: string;
  readonly grain?: string;
  readonly columnUnits?: Readonly<Record<string, LangWatchQLColumnUnit>>;
  readonly descriptions?: Readonly<Record<string, string>>;
  readonly timeColumn?: string;
  readonly joinKeys?: readonly string[];
  /** Reaches a tenant through a parent model when this one has no tenant column. */
  readonly tenantVia?: { readonly parent: string; readonly foreignKey: string };
  /**
   * A visibility rule the application's own repository enforces in code — copied verbatim onto
   * {@link LangWatchQLPostgresMapping.rowFilter}.
   */
  readonly rowFilter?: string;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The default `@db.Decimal` precision Prisma applies when none is annotated. */
const DEFAULT_DECIMAL = "Decimal(65, 30)";

/**
 * The ClickHouse type a Prisma field maps to, or `null` when the column cannot be queried at all
 * (`Bytes`/`Unsupported`) and is stripped with a reason.
 */
export function toClickHouseType(field: PrismaField): string | null {
  const base = toBaseClickHouseType(field);
  if (base === null) return null;
  if (field.isList) return `Array(${base})`;
  if (field.isOptional) return `Nullable(${base})`;
  return base;
}

function toBaseClickHouseType(field: PrismaField): string | null {
  if (field.kind === "unsupported") return null;
  if (field.kind === "enum") return "String";
  switch (field.type) {
    case "String":
    case "Json":
      return "String";
    case "Int":
      return "Int32";
    case "BigInt":
      return "Int64";
    case "Float":
      return "Float64";
    case "Decimal":
      return field.decimal
        ? `Decimal(${field.decimal.precision}, ${field.decimal.scale})`
        : DEFAULT_DECIMAL;
    case "Boolean":
      return "Bool";
    case "DateTime":
      return "DateTime64(3)";
    case "Bytes":
      // documented on purpose: binary columns are stripped, not mapped
      return null;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Safe defaults
// ---------------------------------------------------------------------------

/** Names whose value is a secret, wherever they appear in the column name. */
const SECRET_CONTAINS =
  /(apikey|accesskey|secret|password|credential|privatekey|publickey|lwqlkey|pepper)/i;

/** Suffixes whose value is a secret, singular and plural. */
const SECRET_SUFFIX = /(token|hash|key|keys|hashes|secrets|passwords|credentials)$/i;

/**
 * The reason a column is stripped by the safe defaults, or `undefined` when it is safe to expose.
 */
export function detectDefaultStripReason(name: string): string | undefined {
  const lower = name.toLowerCase();
  if (SECRET_CONTAINS.test(lower)) return "secret material, never exposed";
  if (SECRET_SUFFIX.test(lower) && !lower.endsWith("id")) {
    return "secret material, never exposed";
  }
  if (lower.includes("email")) return "person email, never exposed";
  return undefined;
}

/** The unit a column measures in, by the same rules the catalog guard checks. */
function inferColumnUnit(
  exposedName: string,
  description: string,
): LangWatchQLColumnUnit | undefined {
  if (exposedName.endsWith("Ms")) return "ms";
  if (exposedName.endsWith("TokenCount")) return "tokens";
  if (/\bin USD\b/.test(description)) return "USD";
  if (/millisecond/i.test(description)) return "ms";
  if (/tokens per/i.test(description)) return "tokens/s";
  return undefined;
}

/**
 * A short, publishable description derived from a Prisma `///` doc comment, or `""` when nothing
 * usable remains.
 */
export function sanitizeDescription(raw: string): string {
  if (!raw || raw.trim().length === 0) return "";
  // The customer-facing sentence lives in the opening paragraph; later
  // paragraphs are internal rationale. Wrapped lines rejoin to one line.
  const firstParagraph =
    raw
      .split(/\n\s*\n/)
      .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
      .find((paragraph) => paragraph.length > 0) ?? "";
  let text = firstParagraph
    .replace(/\{[^}]*\}/g, " ") // JSON-shape fragments (also MDX-hostile)
    .replace(/<[^>]*>/g, " ") // angle-bracket fragments (also MDX-hostile)
    .replace(/@\w+/g, " ") // @deprecated / @see and other JSDoc tags
    .replace(/\bADR-\d+\b/gi, " ") // ADR citations
    .replace(/§\s*\d+(?:\s+step\s+\d+)?/gi, " ") // section/step references
    .replace(/(?:\blw)?#\d+\b/gi, " ") // PR/issue numbers (#8209, lw#42)
    .replace(/\(?\bspecs\/\S+?\.feature\)?/gi, " ") // spec file references
    .replace(/\s*\(\s*(?:cf|see|e\.g|and|or|per|plus|etc)\s*[^)]*\)/gi, " ") // (see …)
    .replace(/\bcf\.\b/gi, " ") // "cf." cross-references
    .replace(/\s+\+\s+/g, " ") // "+" delimiters used in lists
    .replace(/\b(?:docs|specs)\/\S+/gi, " ") // doc or spec file paths
    .replace(/\b\w+(?:-\w+)*\.feature\b/gi, " ") // feature file references (with or without path)
    .replace(/\([\s,;:]*\)/g, " "); // parens left holding only punctuation
  // Keep only the first sentence: a period/!/? followed by a capitalised next
  // sentence or the end of the paragraph.
  const sentence = text.match(/^([\s\S]*?[.!?])(?=\s+[A-Z(]|\s*$)/);
  if (sentence) text = sentence[1]!;
  text = text
    .replace(/\(\s*\)/g, " ") // parens left empty by a removal
    .replace(/\(\s*[,;\s]*\)/g, " ") // parens with only spaces and punctuation
    .replace(/\(\s*(.+?)\s*[,;]+\s*\)/g, "($1)") // parens with trailing punctuation: clean it
    .replace(/\s+([.,;:])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim()
    .replace(/[\s,–-]+$/g, "") // dangling separators a removal left behind
    .trim();
  if (text.length === 0) return "";
  if (!/[.!?]$/.test(text)) text += ".";
  return text;
}

/** A field's description: its sanitized `///` doc comment, else the exposed name. */
function columnDescription(field: PrismaField, exposedName: string): string {
  const sanitized = sanitizeDescription(field.documentation);
  return sanitized.length > 0 ? sanitized : exposedName;
}

// ---------------------------------------------------------------------------
// Tenant scope
// ---------------------------------------------------------------------------

/** What {@link resolveTenantScope} needs to resolve a `tenantVia` parent. */
export interface TenantResolveContext {
  readonly manifest: PrismaManifest;
  readonly overrides: Readonly<Record<string, PostgresDatasetOverride>>;
}

/** The field whose `columnName` is `column`, or `undefined`. */
function pickFieldByColumn(model: PrismaModel, column: string): PrismaField | undefined {
  return model.fields.find(
    (field) => (field.kind === "scalar" || field.kind === "enum") && field.columnName === column,
  );
}

/**
 * The tenant scope of one model: which relation carries its owning project, and the join chain that
 * reaches it.
 */
export function resolveTenantScope(
  model: PrismaModel,
  override: PostgresDatasetOverride | undefined,
  context?: TenantResolveContext,
): TenantScope {
  return deriveDirectTenantScope(model) ?? parentTenantScope(model, override, context);
}

/**
 * The scope of a model that carries a tenant column itself — `Project` on its
 * own `id`, else the narrowest of `projectId`/`teamId`/`organizationId`.
 * `undefined` when the model carries none, leaving it to a `tenantVia` parent.
 */
function deriveDirectTenantScope(model: PrismaModel): TenantScope | undefined {
  if (model.name === "Project") {
    return {
      kind: "project",
      column: "id",
      tenantPath: [],
      consumedField: "id",
    };
  }
  for (const column of TENANT_COLUMNS) {
    const field = pickFieldByColumn(model, column);
    if (!field) continue;
    if (column === "projectId") {
      return {
        kind: "project",
        column,
        tenantPath: projectTenantPath(),
        consumedField: field.name,
      };
    }
    if (column === "teamId") {
      return {
        kind: "team",
        column: "id",
        tenantPath: teamTenantPath(),
        consumedField: field.name,
      };
    }
    return {
      kind: "organization",
      column: "id",
      tenantPath: organizationTenantPath(),
      consumedField: field.name,
    };
  }
  return undefined;
}

/**
 * The scope of a tenant-less model, reached through its override's `tenantVia`
 * parent (recursively, so a parent that is itself parent-scoped chains). The
 * foreign key stays an ordinary opaque-id column — no `consumedField`.
 */
function parentTenantScope(
  model: PrismaModel,
  override: PostgresDatasetOverride | undefined,
  context?: TenantResolveContext,
): TenantScope {
  const via = override?.tenantVia;
  if (!via) {
    throw new Error(
      `lwql postgres catalog: model "${model.name}" has no owning tenant column ` +
        `(projectId, teamId or organizationId) and no tenantVia override; ` +
        `catalogue it with a parent or skip it with a reason`,
    );
  }
  if (!context) {
    throw new Error(
      `lwql postgres catalog: resolving the parent of "${model.name}" needs ` +
        `the manifest; call resolveTenantScope with a context`,
    );
  }
  const foreignKey = pickFieldByColumn(model, via.foreignKey);
  if (!foreignKey) {
    throw new Error(
      `lwql postgres catalog: model "${model.name}" tenantVia names foreign ` +
        `key "${via.foreignKey}", which is not a column of the model`,
    );
  }
  const parent = prismaManifestModel(context.manifest, via.parent);
  const parentScope = resolveTenantScope(parent, context.overrides[parent.name], context);
  // Parent-hop aliases are `j0`, `j1`, … — one per parent hop already in the
  // tail — so a nested parent chain never reuses an alias, and the terminal
  // team/org hops keep their fixed `t`/`p`.
  const parentHops = parentScope.tenantPath.filter((hop) => hop.alias.startsWith("j")).length;
  return {
    kind: "parent",
    column: parentScope.column,
    tenantPath: parentTenantPath({
      parent: parent.tableName,
      foreignKey: foreignKey.columnName,
      alias: `j${parentHops}`,
      tail: parentScope.tenantPath,
    }),
  };
}

// ---------------------------------------------------------------------------
// Column build
// ---------------------------------------------------------------------------

/** What the builder reads of a catalogue table; a test may name a model the manifest lacks. */
export type PostgresCatalogueTable = Pick<LwqlTableCatalogue, "columns"> &
  Readonly<{ sourceTable: string }>;

type GatedEntry = Exclude<LwqlColumnEntry, "inherit" | "omit">;

/** A column entry's gates: content as-is, then its permissions; a gate list is allOf. */
function entryGates({
  view,
  name,
  entry,
}: {
  view: string;
  name: string;
  entry: GatedEntry;
}): LangWatchQLViewColumn["gates"] {
  const permissions = accessPermissions(entry.access);
  if (entry.access !== undefined && "anyOf" in entry.access && permissions.length > 1) {
    throw new Error(
      `lwql postgres catalog: view "${view}" column "${name}" declares anyOf; a gate list is allOf`,
    );
  }
  const gates: LangWatchQLViewColumn["gates"][number][] = [];
  const content = entry.content;
  if (typeof content === "string") gates.push(content);
  else if (content !== undefined) gates.push(...content);
  gates.push(...permissions);
  return gates;
}

/** Every permission an access names, whether it asks for all of them or any. */
function accessPermissions(access: LwqlAccess | undefined): readonly AuthzPermission[] {
  if (access === undefined) return [];
  return "allOf" in access ? access.allOf : access.anyOf;
}

/** The non-relation field a catalogue entry names, refused when the model has none. */
function entryField({
  view,
  model,
  fieldName,
}: {
  view: string;
  model: PrismaModel;
  fieldName: string;
}): PrismaField {
  const field = model.fields.find(
    (candidate) => candidate.kind !== "relation" && candidate.name === fieldName,
  );
  if (field === undefined) {
    throw new Error(
      `lwql postgres catalog: view "${view}" names "${fieldName}", which is not a column of ` +
        `${model.name}`,
    );
  }
  return field;
}

/** Every reason a field may never be exposed: binary, the tenant column, a secret or an email. */
function exposureRefusals({ field, scope }: { field: PrismaField; scope: TenantScope }): string[] {
  const refusals: string[] = [];
  if (toClickHouseType(field) === null) refusals.push("binary column, not queryable");
  if (field.name === scope.consumedField) {
    refusals.push("the tenant column, exposed only as TenantId");
  }
  const stripReason = detectDefaultStripReason(field.name);
  if (stripReason !== undefined) refusals.push(stripReason);
  return refusals;
}

/** The field `TenantId` must name as its source: the consumed tenant column, or the parent key. */
function getTenantSourceField({
  model,
  scope,
  override,
}: {
  model: PrismaModel;
  scope: TenantScope;
  override: PostgresDatasetOverride;
}): string {
  if (scope.consumedField !== undefined) return scope.consumedField;
  const foreignKey = override.tenantVia?.foreignKey;
  const field = foreignKey === undefined ? undefined : pickFieldByColumn(model, foreignKey);
  if (field === undefined) {
    throw new Error(`lwql postgres catalog: model "${model.name}" has no tenant field`);
  }
  return field.name;
}

/** Refuses a `TenantId` entry that is gated or reads anything but the tenant's own field. */
function assertTenantEntry({
  view,
  expected,
  entry,
}: {
  view: string;
  expected: string;
  entry: LwqlColumnEntry;
}): void {
  const plain =
    typeof entry === "object" && entry.access === undefined && entry.content === undefined;
  if (!plain || entry.source !== expected) {
    throw new Error(
      `lwql postgres catalog: view "${view}" must declare TenantId as { source: "${expected}" }`,
    );
  }
}

/** An exposed column, with its override-refined description and unit. */
function buildColumn({
  exposedName,
  field,
  type,
  gates,
  override,
}: {
  exposedName: string;
  field: PrismaField;
  type: string;
  gates: LangWatchQLViewColumn["gates"];
  override: PostgresDatasetOverride;
}): LangWatchQLViewColumn {
  const description = override.descriptions?.[exposedName] ?? columnDescription(field, exposedName);
  const unit = override.columnUnits?.[exposedName] ?? inferColumnUnit(exposedName, description);

  return {
    name: exposedName,
    type,
    description,
    gates,
    sourceColumns: [field.columnName],
    ...(unit ? { unit } : {}),
  };
}

// ---------------------------------------------------------------------------
// View build
// ---------------------------------------------------------------------------

/** The `TenantId` column, reading the project off the last tenant-path alias. */
function tenantColumn(scope: TenantScope): LangWatchQLViewColumn {
  return {
    name: TENANT_COLUMN,
    type: "String",
    description: "Project the row belongs to. Join key to every other view.",
    gates: [],
    sourceColumns: [scope.column],
  };
}

/**
 * Appended to a view's description when a `rowFilter` restricts its rows —
 * kept here rather than in each override so the note can never be forgotten
 * by a future `rowFilter` that only sets the predicate.
 */
export const ROW_FILTER_NOTE =
  " Shared Langy conversations only; a member's private conversations are not queryable.";

/** The default view description: the model's doc, else a generated line. */
function viewDescription(
  model: PrismaModel,
  override: PostgresDatasetOverride,
  grain: string,
): string {
  const base = override.description ?? defaultDescription(model, grain);
  return override.rowFilter ? `${base}${ROW_FILTER_NOTE}` : base;
}

/** The model's sanitized doc comment, else a generated line. */
function defaultDescription(model: PrismaModel, grain: string): string {
  const sanitized = sanitizeDescription(model.documentation);
  if (sanitized.length > 0) return sanitized;
  return `Rows of the ${model.name} table, ${grain}.`;
}

/** The grain sentence: a fan-out row appears once per project, a plain one not. */
function defaultGrain({
  isFannedOut,
  scope,
  keyColumns,
}: {
  isFannedOut: boolean;
  scope: TenantScope;
  keyColumns: readonly string[];
}): string {
  if (!isFannedOut) return `one row per ${keyColumns.join(", ")}`;
  return (
    `one row per (${keyColumns.join(", ")}); ` +
    `${fanOutRowSentence(scope.kind)} appears once per project`
  );
}

/** The subject of the fan-out grain sentence, with the correct article. */
function fanOutRowSentence(kind: TenantScope["kind"]): string {
  if (kind === "parent") return "a row reached through its parent";
  const article = kind === "organization" ? "an" : "a";
  return `${article} ${kind}-scoped row`;
}

/**
 * The partition-pruning column: `CreatedAt` if exposed, else the first exposed `DateTime64` column,
 * else `undefined`.
 */
function pickDefaultTimeColumn({
  columns,
}: {
  columns: readonly LangWatchQLViewColumn[];
}): string | undefined {
  const names = new Set(columns.map((column) => column.name));
  if (names.has("CreatedAt")) return "CreatedAt";
  const firstDateTime = columns.find((column) => column.type.includes("DateTime64"));
  return firstDateTime?.name;
}

/** `TenantId` plus every exposed column ending in `Id`, deduplicated. */
function defaultJoinKeys(columns: readonly LangWatchQLViewColumn[]): readonly string[] {
  return [
    TENANT_COLUMN,
    ...columns.map((column) => column.name).filter((name) => name.endsWith("Id")),
  ].filter((key, index, all) => all.indexOf(key) === index);
}

/** `TenantId` first, then every exposed entry in declaration order, and the columns omitted. */
function buildColumns({
  name,
  model,
  table,
  scope,
  override,
}: {
  name: string;
  model: PrismaModel;
  table: PostgresCatalogueTable;
  scope: TenantScope;
  override: PostgresDatasetOverride;
}): { columns: LangWatchQLViewColumn[]; skipColumns: Record<string, string> } {
  const columns: LangWatchQLViewColumn[] = [tenantColumn(scope)];
  const skipColumns: Record<string, string> = {};
  const expectedTenant = getTenantSourceField({ model, scope, override });
  let declaresTenant = false;
  for (const [exposedName, entry] of Object.entries(table.columns)) {
    if (exposedName === TENANT_COLUMN) {
      assertTenantEntry({ view: name, expected: expectedTenant, entry });
      declaresTenant = true;
      continue;
    }
    if (entry === "omit") {
      const field = entryField({ view: name, model, fieldName: exposedName });
      const [reason = "omitted by the catalogue"] = exposureRefusals({ field, scope });
      skipColumns[field.columnName] = reason;
      continue;
    }
    const gated: GatedEntry = entry === "inherit" ? {} : entry;
    const field = entryField({ view: name, model, fieldName: gated.source ?? exposedName });
    const type = toClickHouseType(field);
    const refusals = exposureRefusals({ field, scope });
    if (type === null || refusals.length > 0) {
      throw new Error(
        `lwql postgres catalog: view "${name}" exposes "${exposedName}": ${refusals.join("; ")}`,
      );
    }
    const gates = entryGates({ view: name, name: exposedName, entry: gated });
    columns.push(buildColumn({ exposedName, field, type, gates, override }));
  }
  if (!declaresTenant) {
    throw new Error(`lwql postgres catalog: view "${name}" declares no TenantId entry`);
  }
  return { columns, skipColumns };
}

/** The name a primary-key field is exposed under, refused when the catalogue omits it. */
function exposedKeyName({
  name,
  table,
  scope,
  keyField,
}: {
  name: string;
  table: PostgresCatalogueTable;
  scope: TenantScope;
  keyField: string;
}): string {
  if (keyField === scope.consumedField) return TENANT_COLUMN;
  const exposed = Object.entries(table.columns).find(
    ([exposedName, entry]) =>
      exposedName !== TENANT_COLUMN &&
      entry !== "omit" &&
      (entry === "inherit" ? exposedName : (entry.source ?? exposedName)) === keyField,
  );
  if (exposed === undefined) {
    throw new Error(`lwql postgres catalog: view "${name}" omits its primary key "${keyField}"`);
  }
  return exposed[0];
}

/**
 * Scope resolves before columns build: the tenant path consumes one field, which the catalogue
 * names only as `TenantId`'s source, so a project/team/organization id is never exposed twice.
 */
function deriveModel({
  name,
  model,
  table,
  override,
  context,
}: {
  name: string;
  model: PrismaModel;
  table: PostgresCatalogueTable;
  override: PostgresDatasetOverride;
  context: TenantResolveContext;
}): DerivedPostgresView {
  const scope = resolveTenantScope(model, override, context);
  const isFannedOut = scope.kind !== "project";
  const { columns, skipColumns } = buildColumns({ name, model, table, scope, override });
  const keyColumns = [
    ...(isFannedOut ? [TENANT_COLUMN] : []),
    ...model.primaryKey.map((keyField) => exposedKeyName({ name, table, scope, keyField })),
  ].filter((key, index, all) => all.indexOf(key) === index);

  const grain = override.grain ?? defaultGrain({ isFannedOut, scope, keyColumns });
  const exposedNames = new Set(columns.map((column) => column.name));
  const timeColumn = override.timeColumn ?? pickDefaultTimeColumn({ columns });
  const joinKeys = override.joinKeys ?? defaultJoinKeys(columns);

  assertAnnotationsExposed(name, override, exposedNames);
  assertRowFilterReferencesBaseAlias(name, override);

  return {
    name,
    sourceTable: `${name}_pg`,
    postgres: {
      baseRelation: model.tableName,
      approvedView: `lwql_${name}`,
      tenantSourceColumn: scope.column,
      ...(scope.tenantPath.length > 0 ? { tenantPath: scope.tenantPath } : {}),
      ...(override.rowFilter !== undefined ? { rowFilter: override.rowFilter } : {}),
    },
    description: viewDescription(model, override, grain),
    gates: [],
    grain,
    joinKeys,
    // Absent when the model has no temporal column and no explicit override, so
    // a view never advertises an opaque key as its time dimension.
    ...(timeColumn !== undefined ? { timeColumn } : {}),
    freshness: LIVE_FRESHNESS,
    dedup: { keyColumns },
    columns,
    skipColumns,
  };
}

/** A `rowFilter` that never reads `"m".` filters nothing — refused. */
function assertRowFilterReferencesBaseAlias(name: string, override: PostgresDatasetOverride): void {
  if (override.rowFilter === undefined) return;
  if (!override.rowFilter.includes('"m".')) {
    throw new Error(
      `lwql postgres catalog: view "${name}" rowFilter does not reference the base alias "m"`,
    );
  }
}

/** Every override annotation names an exposed column, or the view is refused. */
function assertAnnotationsExposed(
  name: string,
  override: PostgresDatasetOverride,
  exposedNames: ReadonlySet<string>,
): void {
  for (const [kind, entries] of [
    ["columnUnits", override.columnUnits] as const,
    ["descriptions", override.descriptions] as const,
  ]) {
    for (const key of Object.keys(entries ?? {})) {
      if (!exposedNames.has(key)) {
        throw new Error(
          `lwql postgres catalog: view "${name}": ${kind} names "${key}", ` +
            `which is not an exposed column`,
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/** One catalog view, built from its catalogue table and the model's override. */
export function defineCatalogModel({
  name,
  table,
  overrides = {},
  override = overrides[table.sourceTable] ?? {},
  manifest = LWQL_PRISMA_MANIFEST,
}: {
  /** The view name a statement uses: the catalogue key. */
  readonly name: string;
  readonly table: PostgresCatalogueTable;
  /** Every model's overrides, so a `tenantVia` parent chain resolves. */
  readonly overrides?: Readonly<Record<string, PostgresDatasetOverride>>;
  /** This model's own refinements; defaults to its entry in `overrides`. */
  readonly override?: PostgresDatasetOverride;
  readonly manifest?: PrismaManifest;
}): DerivedPostgresView {
  const context: TenantResolveContext = { manifest, overrides };
  const model = prismaManifestModel(manifest, table.sourceTable);
  return deriveModel({ name, model, table, override, context });
}
