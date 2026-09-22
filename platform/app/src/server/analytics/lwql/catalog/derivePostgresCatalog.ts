/**
 * Derives the PostgreSQL-resident half of the LangWatchQL catalog from the
 * Prisma manifest, opt-*out* exactly as {@link ./defineDatasetFromTable#deriveDefaultCatalog}
 * does for the ClickHouse half.
 *
 * Every tenant-scoped Prisma model becomes a {@link LangWatchQLViewDefinition}
 * unless it is on {@link ./postgresSkippedModels#LWQL_POSTGRES_SKIPPED_MODELS}
 * with a reason. A model earns a view by carrying an owning project — directly
 * (`projectId`), through its team or organization (fanned out to one row per
 * project), or through a declared parent (`tenantVia`). The safe defaults
 * strip secrets and person emails, gate free-text/cost columns, and never
 * expose a raw internal `tenantId`; an override refines any of it and may
 * re-admit a stripped column with a stated reason.
 *
 * The output is shape-identical to a hand-written entry, so the same consumers
 * (schema endpoint, AST validator, provisioning generators) read it without
 * knowing it was derived — and the six views that used to be hand-written in
 * `postgresViews.ts` are now overrides on this derivation.
 *
 * @see ./prismaManifest.ts — the model/field facts this reads
 * @see ./postgresSkippedModels.ts — what opt-out leaves off, and why
 * @see ../provisioning/postgresMapping.ts — the tenant join-chain helpers
 * @see specs/lwql/postgres-catalog.feature
 */

import type { FieldProtection } from "../../../traces/projection/catalog";
import {
  organizationTenantPath,
  type PostgresApprovedViewJoin,
  parentTenantPath,
  projectTenantPath,
  teamTenantPath,
} from "../provisioning/postgresMapping";
import { defaultColumnGates } from "./defineDatasetFromTable";
import {
  type PostgresSkipMap,
  postgresSkipReason,
} from "./postgresSkippedModels";
import { prismaManifestModel } from "./prismaManifest";
import type { PrismaField, PrismaManifest, PrismaModel } from "./prismaSchema";
import type {
  LangWatchQLColumnUnit,
  LangWatchQLViewColumn,
  LangWatchQLViewDefinition,
} from "./types";

/** How far behind the application's writes a PostgreSQL-resident view can be. */
const LIVE_FRESHNESS = "live — read from PostgreSQL at query time";

/** The name every view exposes the owning project under. */
const TENANT_COLUMN = "TenantId";

/** The three direct tenant columns, narrowest first. */
const TENANT_COLUMNS = ["projectId", "teamId", "organizationId"] as const;

/**
 * A derived view, plus the record of every column the safe defaults stripped.
 *
 * `skipColumns` mirrors {@link DefineDatasetFromTableInput.skipColumns}: a
 * stripped column is absent from {@link LangWatchQLViewDefinition.columns} and
 * present here mapped to the reason it is omitted, so the coverage guard can
 * print the reason and a strip with no reason cannot be written.
 */
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
  readonly name?: string;
  readonly description?: string;
  readonly grain?: string;
  /** Renames: `{ exposedName: sourceColumn }`, winning over the default name. */
  readonly aliases?: Readonly<Record<string, string>>;
  /** Extra source columns to strip, each mapped to the reason it is omitted. */
  readonly skipColumns?: Readonly<Record<string, string>>;
  /** Per-column gates, keyed by exposed name; `[]` lifts a default gate. */
  readonly columnGates?: Readonly<Record<string, readonly FieldProtection[]>>;
  readonly columnUnits?: Readonly<Record<string, LangWatchQLColumnUnit>>;
  readonly descriptions?: Readonly<Record<string, string>>;
  readonly timeColumn?: string;
  readonly joinKeys?: readonly string[];
  /** Reaches a tenant through a parent model when this one has no tenant column. */
  readonly tenantVia?: { readonly parent: string; readonly foreignKey: string };
  /**
   * Re-admits a column the safe defaults would strip, each mapped to the reason
   * it is safe to expose. A re-admit without a non-empty reason is refused.
   */
  readonly reAdmit?: Readonly<Record<string, string>>;
  /**
   * A visibility rule the application's own repository enforces in code —
   * copied verbatim onto {@link LangWatchQLPostgresMapping.rowFilter}. A model
   * whose repository already restricts which rows a caller may read (e.g. "own
   * or shared") gets this instead of a skip, since the reader role only ever
   * sees the approved view and that is the one place left to enforce it. May
   * use the `{{schema}}` token to name a sibling relation — see
   * {@link LangWatchQLPostgresMapping.rowFilter}.
   */
  readonly rowFilter?: string;
}

// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------

/** Splits a model name into words, keeping acronyms whole (`LLM`, `S3`). */
function splitWords(modelName: string): string[] {
  return modelName
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toLowerCase()
    .split("_");
}

/** English-plural of the final word, enough for the model names we carry. */
function pluralize(word: string): string {
  if (word.endsWith("s")) return word;
  if (/[^aeiou]y$/.test(word)) return `${word.slice(0, -1)}ies`;
  if (/(s|x|z|ch|sh)$/.test(word)) return `${word}es`;
  return `${word}s`;
}

/**
 * The view name a model gets: acronym-aware `snake_case`, last word pluralised
 * (`CustomLLMModelCost` → `custom_llm_model_costs`, `Topic` → `topics`,
 * `RoutingPolicy` → `routing_policies`, `Analytics` → `analytics`).
 */
export function postgresDatasetName(modelName: string): string {
  const words = splitWords(modelName);
  const last = words.length - 1;
  words[last] = pluralize(words[last]!);
  return words.join("_");
}

/** One field name in PascalCase, preserving internal capitals and digits. */
function pascalCase(name: string): string {
  return name
    .split("_")
    .map((segment) =>
      segment.length > 0
        ? segment[0]!.toUpperCase() + segment.slice(1)
        : segment,
    )
    .join("");
}

/**
 * The name a column is exposed under: the primary key `id` becomes
 * `<Model>Id` (`Topic.id` → `TopicId`), and every other field is PascalCased
 * (`embeddings_model` → `EmbeddingsModel`, `p95Distance` → `P95Distance`). The
 * tenant column is handled by the caller, which exposes it as `TenantId`.
 */
export function exposedColumnName({
  modelName,
  fieldName,
  primaryKey,
}: {
  modelName: string;
  fieldName: string;
  primaryKey: readonly string[];
}): string {
  if (fieldName === "id" && primaryKey.includes("id")) return `${modelName}Id`;
  return pascalCase(fieldName);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The default `@db.Decimal` precision Prisma applies when none is annotated. */
const DEFAULT_DECIMAL = "Decimal(65, 30)";

/**
 * The ClickHouse type a Prisma field maps to, or `null` when the column cannot
 * be queried at all (`Bytes`/`Unsupported`) and is stripped with a reason.
 *
 * `String`/enum/`Json` → `String`, `Int` → `Int32`, `BigInt` → `Int64`,
 * `Float` → `Float64`, `Decimal(p, s)` → `Decimal(p, s)`, `Boolean` → `Bool`,
 * `DateTime` → `DateTime64(3)`. A list wraps in `Array(...)`; an optional
 * scalar wraps in `Nullable(...)`.
 */
export function clickHouseTypeFor(field: PrismaField): string | null {
  const base = baseClickHouseType(field);
  if (base === null) return null;
  if (field.isList) return `Array(${base})`;
  if (field.isOptional) return `Nullable(${base})`;
  return base;
}

function baseClickHouseType(field: PrismaField): string | null {
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

/**
 * Suffixes whose value is a secret, singular and plural. `keys`/`hashes`/
 * `secrets`/`passwords`/`credentials` are here because a plural (`customKeys`)
 * carries no secret *word* the contains rule would catch, yet is still key
 * material. `tokens` is deliberately absent: `promptTokens`/`completionTokens`
 * are counts, not credentials.
 */
const SECRET_SUFFIX =
  /(token|hash|key|keys|hashes|secrets|passwords|credentials)$/i;

/**
 * The reason a column is stripped by the safe defaults, or `undefined` when it
 * is safe to expose.
 *
 * Secret material — a name containing a secret word, or ending in `token`,
 * `hash`, `key`, `keys`, `hashes`, `secrets`, `passwords` or `credentials`
 * without ending in `id` (so `s3AccessKeyId` is stripped by the contains rule,
 * `customKeys` by the suffix rule, while `parentId` and `promptTokens` survive
 * — `tokens` is a count, not a credential) — is never exposed. Person emails —
 * any name *containing* `email` (`email`, `reviewer_email`,
 * `notificationEmails`, `emailAddress`), not just an exact match or `Email`
 * suffix — are never exposed; a `userId`-like column stays, as an opaque id.
 */
export function isStrippedByDefault(name: string): string | undefined {
  const lower = name.toLowerCase();
  if (SECRET_CONTAINS.test(lower)) return "secret material, never exposed";
  if (SECRET_SUFFIX.test(lower) && !lower.endsWith("id")) {
    return "secret material, never exposed";
  }
  if (lower.includes("email")) return "person email, never exposed";
  return undefined;
}

/**
 * Postgres String columns whose value is a categorical label, not free text.
 *
 * The ClickHouse derivation tells a label from a body by its *type*: a label is
 * a `LowCardinality(String)`, which {@link ./defineDatasetFromTable#isContentType}
 * reads as "not content" and leaves ungated. Prisma carries no such wrapper — an
 * enum and a free-text `String` both map to a plain `String` (see
 * {@link clickHouseTypeFor}) — so a Postgres label would be gated `output` by
 * name-blind default. That gate is not merely cosmetic: the validator gates by
 * lowercased bare name across the *whole* catalog, so a Postgres `Provider`
 * gated here withholds `Provider` on the ClickHouse `governance_*` views too.
 *
 * These suffixes name a fixed vocabulary, never a body: `Provider` (an
 * integration's name — `openai`, `github`), `Host` (a host provider —
 * `github.com`), `Role` (an actor role — `user`/`assistant`/`system`/`tool`),
 * `Scope` (an ownership/visibility scope — `personal`/`project`/`organization`),
 * `Action` (a categorical operation — an audit-log or trigger action name). A
 * String column ending in one is a label and stays ungated; a genuinely
 * free-text column that happens to end in `Scope`/`Action` (e.g.
 * `SimulationSuite.scope` or `GatewayCacheRule.action`, both JSON blobs) is
 * aliased to a non-label name in its override so it keeps its gate. Enums are
 * handled separately, by {@link postgresColumnGates}, since they are labels
 * whatever their exposed name.
 *
 * The capital letter each suffix starts with acts as a word boundary — an
 * exposed name is PascalCase — so `Ghost` never reads as `…Host` and `Reaction`
 * never reads as `…Action`.
 */
const POSTGRES_LABEL_NAME = /(Provider|Host|Role|Scope|Action)$/;

/**
 * The gates a Postgres column gets before any override, widening
 * {@link ./defineDatasetFromTable#defaultColumnGates} for the two label shapes
 * Prisma flattens into a plain `String`:
 *
 *  - an **enum** field is a label whatever its name — the enum vocabulary is the
 *    whole domain, so it can never carry customer content and stays ungated;
 *  - a **String** field whose exposed name ends in a {@link POSTGRES_LABEL_NAME}
 *    suffix is a categorical label and stays ungated.
 *
 * Everything else defers to the shared classifier, so cost columns still gate
 * `costs` and free-text bodies still gate `output`. Consistency with the
 * ClickHouse half matters because the validator gates a bare name catalog-wide:
 * a name gated on one view withholds it on every other.
 */
function postgresColumnGates({
  field,
  exposedName,
  type,
}: {
  field: PrismaField;
  exposedName: string;
  type: string;
}): readonly FieldProtection[] {
  if (field.kind === "enum") return [];
  if (POSTGRES_LABEL_NAME.test(exposedName)) return [];
  return defaultColumnGates({ name: exposedName, type });
}

/** The unit a column measures in, by the same rules the catalog guard checks. */
function defaultColumnUnit(
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
 * A short, publishable description derived from a Prisma `///` doc comment, or
 * `""` when nothing usable remains.
 *
 * A Prisma doc comment is written for the engineer reading the schema: it wraps
 * across `///` lines, opens with the customer-facing sentence and then trails
 * into internal prose — spec/PR references, ADR citations, `@deprecated`
 * markers, JSON-shape fragments in `{ ... }` and `< ... >`, and design notes in
 * later paragraphs. Publishing the whole comment leaks that prose into the docs,
 * the schema endpoint and the MCP reference (and its `{ ... }`/`< ... >` breaks
 * the MDX parser); publishing only the first *line* ships a mid-sentence
 * fragment. This keeps the first sentence of the first paragraph and strips the
 * internal markup, so the published surface reads as one clean sentence.
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
    .replace(/\s*\(\s*(?:cf|see|e\.g|and|or|per|plus|etc)\s*[^)]*\)/gi, " ") // parentheticals starting with connector words, remove entire parens + contents
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
function fieldByColumn(
  model: PrismaModel,
  column: string,
): PrismaField | undefined {
  return model.fields.find(
    (field) =>
      (field.kind === "scalar" || field.kind === "enum") &&
      field.columnName === column,
  );
}

/**
 * The tenant scope of one model: which relation carries its owning project, and
 * the join chain that reaches it. Narrowest wins — `projectId` over `teamId`
 * over `organizationId` — so a model carrying more than one takes the narrowest
 * and applies no fan-out. `Project` itself is scoped on its own `id`. A model
 * with no tenant column resolves through its override's `tenantVia` parent,
 * recursively, so a parent that is itself parent-scoped chains correctly.
 */
export function resolveTenantScope(
  model: PrismaModel,
  override: PostgresDatasetOverride | undefined,
  context?: TenantResolveContext,
): TenantScope {
  return (
    directTenantScope(model) ?? parentTenantScope(model, override, context)
  );
}

/**
 * The scope of a model that carries a tenant column itself — `Project` on its
 * own `id`, else the narrowest of `projectId`/`teamId`/`organizationId`.
 * `undefined` when the model carries none, leaving it to a `tenantVia` parent.
 */
function directTenantScope(model: PrismaModel): TenantScope | undefined {
  if (model.name === "Project") {
    return {
      kind: "project",
      column: "id",
      tenantPath: [],
      consumedField: "id",
    };
  }
  for (const column of TENANT_COLUMNS) {
    const field = fieldByColumn(model, column);
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
  const foreignKey = fieldByColumn(model, via.foreignKey);
  if (!foreignKey) {
    throw new Error(
      `lwql postgres catalog: model "${model.name}" tenantVia names foreign ` +
        `key "${via.foreignKey}", which is not a column of the model`,
    );
  }
  const parent = prismaManifestModel(context.manifest, via.parent);
  const parentScope = resolveTenantScope(
    parent,
    context.overrides[parent.name],
    context,
  );
  // Parent-hop aliases are `j0`, `j1`, … — one per parent hop already in the
  // tail — so a nested parent chain never reuses an alias, and the terminal
  // team/org hops keep their fixed `t`/`p`.
  const parentHops = parentScope.tenantPath.filter((hop) =>
    hop.alias.startsWith("j"),
  ).length;
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

/** A source field resolved to how it is exposed, or why it is not. */
interface ResolvedColumn {
  readonly column?: LangWatchQLViewColumn;
  readonly skip?: { readonly source: string; readonly reason: string };
}

function resolveColumn({
  model,
  field,
  scope,
  override,
  aliasByColumn,
}: {
  model: PrismaModel;
  field: PrismaField;
  scope: TenantScope;
  override: PostgresDatasetOverride;
  aliasByColumn: ReadonlyMap<string, string>;
}): ResolvedColumn | null {
  if (field.kind === "relation") return null;
  if (field.name === scope.consumedField) return null;

  const source = field.columnName;
  const type = clickHouseTypeFor(field);
  const exposedName =
    aliasByColumn.get(source) ??
    exposedColumnName({
      modelName: model.name,
      fieldName: field.name,
      primaryKey: model.primaryKey,
    });

  const reason = columnSkipReason({
    source,
    type,
    exposedName,
    field,
    override,
  });
  if (reason !== undefined) return { skip: { source, reason } };

  return {
    // `type` is non-null here: `columnSkipReason` returns the binary reason
    // when it is null, so a null would have short-circuited above.
    column: buildColumn({ source, type: type!, exposedName, field, override }),
  };
}

/**
 * The reason a resolved column is stripped, or `undefined` when it is exposed:
 * a manual `skipColumns` entry, an unqueryable binary type, a name colliding
 * with the real `TenantId` (an internal `tenantId`, never the owning project),
 * or a safe-default strip with no re-admit.
 */
function columnSkipReason({
  source,
  type,
  exposedName,
  field,
  override,
}: {
  source: string;
  type: string | null;
  exposedName: string;
  field: PrismaField;
  override: PostgresDatasetOverride;
}): string | undefined {
  const manualSkip = override.skipColumns?.[source];
  if (manualSkip !== undefined) return manualSkip;
  if (type === null) return "binary column, not queryable";
  if (exposedName === TENANT_COLUMN) {
    return "internal tenant id (process-manager/migration plumbing), not the owning project";
  }
  const stripReason = isStrippedByDefault(field.name);
  const reAdmit = override.reAdmit?.[exposedName];
  if (stripReason !== undefined && reAdmit === undefined) return stripReason;
  return undefined;
}

/** An exposed column, with its override-refined description, gates and unit. */
function buildColumn({
  source,
  type,
  exposedName,
  field,
  override,
}: {
  source: string;
  type: string;
  exposedName: string;
  field: PrismaField;
  override: PostgresDatasetOverride;
}): LangWatchQLViewColumn {
  const description =
    override.descriptions?.[exposedName] ??
    columnDescription(field, exposedName);
  const gates =
    override.columnGates?.[exposedName] ??
    postgresColumnGates({ field, exposedName, type });
  const unit =
    override.columnUnits?.[exposedName] ??
    defaultColumnUnit(exposedName, description);

  return {
    name: exposedName,
    type,
    description,
    gates,
    sourceColumns: [source],
    ...(unit ? { unit } : {}),
  };
}

/** The exposed name a primary-key field resolves to (alias- and tenant-aware). */
function exposedKeyName({
  model,
  keyField,
  scope,
  aliasByColumn,
}: {
  model: PrismaModel;
  keyField: string;
  scope: TenantScope;
  aliasByColumn: ReadonlyMap<string, string>;
}): string {
  const field = model.fields.find((entry) => entry.name === keyField);
  const source = field?.columnName ?? keyField;
  if (field && field.name === scope.consumedField) return TENANT_COLUMN;
  return (
    aliasByColumn.get(source) ??
    exposedColumnName({
      modelName: model.name,
      fieldName: keyField,
      primaryKey: model.primaryKey,
    })
  );
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

/**
 * The model's sanitized doc comment, else a generated line.
 *
 * {@link sanitizeDescription} takes the first sentence of the comment and
 * strips its internal markup, so the docs, the schema endpoint and the MCP
 * reference publish one clean customer-facing sentence rather than the whole
 * internal comment (which leaks spec/PR references and breaks the MDX parser)
 * or a mid-sentence first-line fragment. A model with no usable comment falls
 * back to a generated line naming its grain.
 */
function defaultDescription(model: PrismaModel, grain: string): string {
  const sanitized = sanitizeDescription(model.documentation);
  if (sanitized.length > 0) return sanitized;
  return `Rows of the ${model.name} table, ${grain}.`;
}

/** An override's `{ exposedName: source }` aliases, keyed the way build reads. */
function aliasMap(
  override: PostgresDatasetOverride,
): ReadonlyMap<string, string> {
  const aliasByColumn = new Map<string, string>();
  for (const [exposed, source] of Object.entries(override.aliases ?? {})) {
    aliasByColumn.set(source, exposed);
  }
  return aliasByColumn;
}

/** The `TenantId` column plus every exposed field, and the columns stripped. */
function buildColumns({
  model,
  scope,
  override,
  aliasByColumn,
}: {
  model: PrismaModel;
  scope: TenantScope;
  override: PostgresDatasetOverride;
  aliasByColumn: ReadonlyMap<string, string>;
}): { columns: LangWatchQLViewColumn[]; skipColumns: Record<string, string> } {
  const columns: LangWatchQLViewColumn[] = [tenantColumn(scope)];
  const skipColumns: Record<string, string> = {};
  for (const field of model.fields) {
    const resolved = resolveColumn({
      model,
      field,
      scope,
      override,
      aliasByColumn,
    });
    if (!resolved) continue;
    if (resolved.skip) skipColumns[resolved.skip.source] = resolved.skip.reason;
    if (resolved.column) columns.push(resolved.column);
  }
  return { columns, skipColumns };
}

/** The dedup key: the exposed primary key, `TenantId` first when it fans out. */
function deriveKeyColumns({
  model,
  scope,
  aliasByColumn,
  isFannedOut,
}: {
  model: PrismaModel;
  scope: TenantScope;
  aliasByColumn: ReadonlyMap<string, string>;
  isFannedOut: boolean;
}): string[] {
  const pkExposed = model.primaryKey.map((keyField) =>
    exposedKeyName({ model, keyField, scope, aliasByColumn }),
  );
  return [...(isFannedOut ? [TENANT_COLUMN] : []), ...pkExposed].filter(
    (key, index, all) => all.indexOf(key) === index,
  );
}

/**
 * Scope resolves before columns build: {@link resolveColumn} needs
 * `scope.consumedField` to leave the field the tenant path already consumes
 * out of the exposed columns, so a project/team/organization id is never
 * exposed twice under two names.
 */
function deriveModel({
  model,
  override,
  context,
}: {
  model: PrismaModel;
  override: PostgresDatasetOverride;
  context: TenantResolveContext;
}): DerivedPostgresView {
  const scope = resolveTenantScope(model, override, context);
  const isFannedOut = scope.kind !== "project";
  const aliasByColumn = aliasMap(override);

  const { columns, skipColumns } = buildColumns({
    model,
    scope,
    override,
    aliasByColumn,
  });
  const keyColumns = deriveKeyColumns({
    model,
    scope,
    aliasByColumn,
    isFannedOut,
  });

  const name = override.name ?? postgresDatasetName(model.name);
  const grain =
    override.grain ?? defaultGrain({ isFannedOut, scope, keyColumns });
  const exposedNames = new Set(columns.map((column) => column.name));
  const timeColumn = override.timeColumn ?? defaultTimeColumn({ columns });
  const joinKeys = override.joinKeys ?? defaultJoinKeys(columns);

  assertOverride({ name, model, override, exposedNames });

  return {
    name,
    sourceTable: `${name}_pg`,
    postgres: {
      baseRelation: model.tableName,
      approvedView: `lwql_${name}`,
      tenantSourceColumn: scope.column,
      ...(scope.tenantPath.length > 0 ? { tenantPath: scope.tenantPath } : {}),
      ...(override.rowFilter !== undefined
        ? { rowFilter: override.rowFilter }
        : {}),
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
 * The partition-pruning column: `CreatedAt` if exposed, else the first exposed
 * `DateTime64` column, else `undefined`.
 *
 * A model with no temporal column has nothing to prune partitions on, so it
 * gets no default time column at all rather than falling back to a key column —
 * which would advertise an opaque id (in the fan-out case, the raw `TenantId`)
 * as the dataset's time dimension in the docs and the schema endpoint. A model
 * that genuinely wants a non-temporal ordering column names it with an explicit
 * `timeColumn` override.
 */
function defaultTimeColumn({
  columns,
}: {
  columns: readonly LangWatchQLViewColumn[];
}): string | undefined {
  const names = new Set(columns.map((column) => column.name));
  if (names.has("CreatedAt")) return "CreatedAt";
  const firstDateTime = columns.find((column) =>
    column.type.includes("DateTime64"),
  );
  return firstDateTime?.name;
}

/** `TenantId` plus every exposed column ending in `Id`, deduplicated. */
function defaultJoinKeys(
  columns: readonly LangWatchQLViewColumn[],
): readonly string[] {
  return [
    TENANT_COLUMN,
    ...columns
      .map((column) => column.name)
      .filter((name) => name.endsWith("Id")),
  ].filter((key, index, all) => all.indexOf(key) === index);
}

/** Refuses an override annotation naming a column the view does not expose. */
function assertOverride({
  name,
  model,
  override,
  exposedNames,
}: {
  name: string;
  model: PrismaModel;
  override: PostgresDatasetOverride;
  exposedNames: ReadonlySet<string>;
}): void {
  assertReAdmitReasons(name, override);
  assertAnnotationsExposed(name, override, exposedNames);
  assertSkipColumnsExist(name, model, override);
  assertRowFilterReferencesBaseAlias(name, override);
}

/** A `rowFilter` that never reads `"m".` filters nothing — refused. */
function assertRowFilterReferencesBaseAlias(
  name: string,
  override: PostgresDatasetOverride,
): void {
  if (override.rowFilter === undefined) return;
  if (!override.rowFilter.includes('"m".')) {
    throw new Error(
      `lwql postgres catalog: view "${name}" rowFilter does not reference the base alias "m"`,
    );
  }
}

/** Every `skipColumns` key names a real source column, or the view is refused. */
function assertSkipColumnsExist(
  name: string,
  model: PrismaModel,
  override: PostgresDatasetOverride,
): void {
  const sourceColumns = new Set(
    model.fields
      .filter((field) => field.kind !== "relation")
      .map((field) => field.columnName),
  );
  for (const column of Object.keys(override.skipColumns ?? {})) {
    if (!sourceColumns.has(column)) {
      throw new Error(
        `lwql postgres catalog: view "${name}" skipColumns names "${column}", ` +
          `which is not a source column of ${model.name}`,
      );
    }
  }
}

/** Every `reAdmit` entry carries a non-empty reason, or the view is refused. */
function assertReAdmitReasons(
  name: string,
  override: PostgresDatasetOverride,
): void {
  for (const [column, reason] of Object.entries(override.reAdmit ?? {})) {
    if (reason.trim().length === 0) {
      throw new Error(
        `lwql postgres catalog: view "${name}" re-admits "${column}" with no reason`,
      );
    }
  }
}

/** Every override annotation names an exposed column, or the view is refused. */
function assertAnnotationsExposed(
  name: string,
  override: PostgresDatasetOverride,
  exposedNames: ReadonlySet<string>,
): void {
  for (const [kind, entries] of [
    ["columnGates", override.columnGates] as const,
    ["columnUnits", override.columnUnits] as const,
    ["descriptions", override.descriptions] as const,
    ["reAdmit", override.reAdmit] as const,
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

/**
 * Every tenant-scoped Prisma model that is not skipped, as a derived view
 * definition, in manifest order (the caller sorts by name).
 *
 * A model earns a view by carrying an owning project; it stays off only by
 * being in `skip` with a reason. Defaults are safe — secrets and emails
 * stripped, free-text and cost columns gated, an internal `tenantId` never
 * exposed — and an override refines any of them.
 */
export function derivePostgresCatalog({
  manifest,
  skip,
  overrides = {},
}: {
  manifest: PrismaManifest;
  skip: PostgresSkipMap;
  overrides?: Readonly<Record<string, PostgresDatasetOverride>>;
}): DerivedPostgresView[] {
  const context: TenantResolveContext = { manifest, overrides };
  return manifest.models
    .filter((model) => postgresSkipReason(model.name, skip) === undefined)
    .map((model) =>
      deriveModel({ model, override: overrides[model.name] ?? {}, context }),
    );
}
