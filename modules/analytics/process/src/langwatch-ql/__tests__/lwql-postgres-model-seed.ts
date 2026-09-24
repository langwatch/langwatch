/**
 * One row per derived Postgres view's base model, for one tenant, so the isolation proof
 * has a row it could have leaked for every view: the tenant link set to the seeded spine,
 * stripped strings marked `excluded-`, nullable columns left null, required ones filled
 */

import type { DerivedPostgresView } from "../../rules/lwql-postgres-catalog-model.rules.ts";
import { prismaManifestEnum } from "../../rules/lwql-prisma-manifest.rules.ts";
import type {
  PrismaField,
  PrismaManifest,
  PrismaModel,
} from "../../rules/lwql-prisma-schema.rules.ts";

/** The subset of a derived view this seeder reads; a supertype of `DerivedPostgresView`. */
export interface SeedableView {
  readonly postgres?: {
    /** Application table the view reads. */
    readonly baseRelation: string;
    /** Column read on the last tenant-path alias to yield `TenantId`. */
    readonly tenantSourceColumn: string;
    /** Join chain to the relation carrying the owning project (absent = none). */
    readonly tenantPath?: readonly {
      readonly relation: string;
      readonly alias: string;
      readonly on: { readonly from: string; readonly to: string };
    }[];
  };
  /** Source columns the builder stripped, mapped to the reason. */
  readonly skipColumns: Readonly<Record<string, string>>;
}

/** A fixed timestamp for every `DateTime` column, matching the explicit seeds. */
const SEED_STAMP = "2026-01-01T00:00:00Z";

/**
 * The primary-key value the explicitly-seeded models carry, so a generic row's foreign key
 * to one of them points at a row that exists.
 */
const EXPLICIT_SEED_ID: Record<string, (tenantId: string) => string> = {
  Organization: (t) => `${t}-org`,
  Team: (t) => `${t}-team`,
  User: (t) => `${t}-user`,
  Project: (t) => t,
  VirtualKey: (t) => `${t}-vk`,
  Topic: (t) => `${t}-topic-1`,
  Annotation: (t) => `${t}-note-1`,
  Experiment: (t) => `${t}-experiment`,
  BatchEvaluation: (t) => `${t}-run-1`,
  LlmPromptConfig: (t) => `${t}-prompt`,
  LlmPromptConfigVersion: (t) => `${t}-prompt-v1`,
};

/**
 * The id a foreign key targeting `model` should point at, for this tenant.
 */
function seededId(
  model: string,
  tenantId: string,
  explicitIds?: Readonly<Record<string, string>>,
): string {
  return explicitIds?.[model] ?? EXPLICIT_SEED_ID[model]?.(tenantId) ?? `${tenantId}-${model}-1`;
}

/** A double-quoted SQL identifier. */
function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** A single-quoted SQL string literal. */
function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** The sentinel a column resolver returns to omit the column from the INSERT. */
const OMIT = Symbol("omit-column");
type CellValue = string | typeof OMIT;

/** Field-name → related model, for every FK-holding relation of a model. */
function foreignKeyTargets(model: PrismaModel): Map<string, string> {
  const map = new Map<string, string>();
  for (const field of model.fields) {
    if (field.kind !== "relation" || !field.relation) continue;
    for (const fkFieldName of field.relation.fields) {
      map.set(fkFieldName, field.relation.to);
    }
  }
  return map;
}

/** The first value of an enum, cast to its Postgres type. */
function enumDefault(manifest: PrismaManifest, enumName: string): CellValue {
  const first = prismaManifestEnum(manifest, enumName).values[0];
  if (!first) return OMIT;
  return `${quoteLiteral(first)}::${quoteIdent(enumName)}`;
}

/** The empty-array literal for a list column, or `OMIT` when it is skipped. */
function listDefault(field: PrismaField): CellValue {
  if (field.kind === "enum") return `ARRAY[]::${quoteIdent(field.type)}[]`;
  switch (field.type) {
    case "String":
      return "ARRAY[]::text[]";
    case "Int":
      return "ARRAY[]::integer[]";
    case "BigInt":
      return "ARRAY[]::bigint[]";
    case "Float":
      return "ARRAY[]::double precision[]";
    case "Decimal":
      return "ARRAY[]::numeric[]";
    case "Boolean":
      return "ARRAY[]::boolean[]";
    case "DateTime":
      return "ARRAY[]::timestamp[]";
    // A JSON list has no safe empty literal the way `{}` serves a scalar JSON,
    // and every one in the derived models is nullable, so it is left out.
    default:
      return OMIT;
  }
}

/** A type-correct filler for a non-relation column with no id/tenant meaning. */
function typeDefault(field: PrismaField, tenantId: string, manifest: PrismaManifest): CellValue {
  if (field.isList) return listDefault(field);
  if (field.kind === "enum") return enumDefault(manifest, field.type);
  switch (field.type) {
    case "String":
      return quoteLiteral(`${tenantId}-${field.columnName}`);
    case "Int":
    case "BigInt":
    case "Float":
    case "Decimal":
      return "1";
    case "Boolean":
      return "false";
    case "DateTime":
      return quoteLiteral(SEED_STAMP);
    case "Json":
      return "'{}'::jsonb";
    default:
      return OMIT;
  }
}

/** The column linking a view's base row to the tenant spine, and its value. */
function tenantLink(
  view: DerivedPostgresView,
  ids: SeedIds,
  modelByTable: ReadonlyMap<string, PrismaModel>,
): { column: string; value: string } {
  const postgres = view.postgres;
  if (!postgres) throw new Error("lwql seed: a derived view carries no postgres mapping");
  const [first] = postgres.tenantPath ?? [];
  if (!first) {
    // Project-scoped: the tenant-source column is a real column on the base
    // relation (`projectId`, or `id` on Project itself), set to the project.
    return { column: postgres.tenantSourceColumn, value: ids.tenantId };
  }
  if (first.on.from === "teamId") return { column: "teamId", value: ids.teamId };
  if (first.on.from === "organizationId") {
    return { column: "organizationId", value: ids.organizationId };
  }
  // Parent scope: the base column holds a foreign key to a parent the tenant is
  // reached through; point it at the parent row's seeded id.
  const parentModel = modelByTable.get(first.relation)?.name ?? first.relation;
  return {
    column: first.on.from,
    value: seededId(parentModel, ids.tenantId, ids.explicitIds),
  };
}

/**
 * Per-(model, column) literal overrides that win over every generic rule in {@link
 * columnValue} below. A CHECK constraint that ties two or more nullable columns to each
 * other (an enum-discriminated shape, a paired credential) can't be satisfied by seeding
 */
const SEED_COLUMN_OVERRIDES: Readonly<Record<string, Readonly<Record<string, string | null>>>> = {
  // `extraHeaders` is Json, so rule 4's string-only marker never fires for it;
  // this override nests the marker inside realistic header JSON so the
  // generic "no excluded- marker leaks" isolation proof also exercises it.
  ModelProvider: {
    extraHeaders: `'[{"key":"Authorization","value":"excluded-extraHeaders-marker"}]'::jsonb`,
  },

  // Every Langy view admits only shared conversations, down to the engine
  // table, so the one generic conversation is seeded shared or the per-dataset
  // proofs over the five Langy tables would find nothing and pass vacuously.
  LangyConversationProjection: {
    isShared: "true",
  },
};

/** The four ids the harness seeds the tenant spine with. */
interface SeedIds {
  readonly tenantId: string;
  readonly organizationId: string;
  readonly teamId: string;
  readonly userId: string;
  /** Model name → the id its explicit seed actually used, when caller-chosen. */
  readonly explicitIds?: Readonly<Record<string, string>>;
}

/** The value one column of one model's generic row takes. */
function columnValue({
  field,
  model,
  view,
  link,
  fkTargets,
  ids,
  manifest,
}: {
  field: PrismaField;
  model: PrismaModel;
  view: DerivedPostgresView;
  link: { column: string; value: string };
  fkTargets: ReadonlyMap<string, string>;
  ids: SeedIds;
  manifest: PrismaManifest;
}): CellValue {
  const column = field.columnName;

  // 0. A per-model override — wins over every rule below. Reserved for a
  // CHECK constraint that ties nullable columns to each other; every other
  // column is covered by the generic rules.
  const override = SEED_COLUMN_OVERRIDES[model.name]?.[column];
  if (override !== undefined) return override === null ? "NULL" : override;

  // 1. The tenant link — always set, even when the column is nullable, or the
  // join lands nowhere and the row is invisible to the isolation proof.
  if (column === link.column) return quoteLiteral(link.value);

  // 2. A single-column primary key. An integer key is autoincrement (the only
  // one in the schema is `GatewayChangeEvent.revision`) — omitted so the
  // sequence assigns a value unique across tenants; a string key takes the
  // generic id every foreign key to this model points at.
  if (model.primaryKey.length === 1 && model.primaryKey[0] === field.name) {
    if (field.type === "Int" || field.type === "BigInt") return OMIT;
    return quoteLiteral(seededId(model.name, ids.tenantId, ids.explicitIds));
  }

  // 3. A foreign key. The tenant spine resolves to the ids the harness seeded;
  // a nullable FK to anything else is left null (nothing joins on it, and a
  // real FK stays satisfied); a NOT NULL FK points at that model's seeded id.
  const target = fkTargets.get(field.name);
  if (column === "projectId" || target === "Project") {
    return quoteLiteral(ids.tenantId);
  }
  if (column === "teamId" || target === "Team") return quoteLiteral(ids.teamId);
  if (column === "organizationId" || target === "Organization") {
    return quoteLiteral(ids.organizationId);
  }
  if (target === "User" || column === "userId" || column.endsWith("ById")) {
    return field.isOptional ? "NULL" : quoteLiteral(ids.userId);
  }
  if (target) {
    return field.isOptional
      ? "NULL"
      : quoteLiteral(seededId(target, ids.tenantId, ids.explicitIds));
  }

  // 4. A stripped column, given a marker so the isolation test can assert its
  // data never surfaces. Only strings carry it — a stripped date or json keeps
  // a type-correct value, since its exclusion is proven by the string columns.
  if (
    view.skipColumns[column] !== undefined &&
    field.kind === "scalar" &&
    field.type === "String" &&
    !field.isList
  ) {
    return quoteLiteral(`excluded-${column}-of-${ids.tenantId}`);
  }

  // 5. Minimal row: a nullable column with no other meaning stays null, so a
  // CHECK tying nullable columns together holds by construction (filling them
  // broke WebhookEndpoint_destination_shape_check); required ones get a filler.
  if (field.isOptional) return "NULL";
  return typeDefault(field, ids.tenantId, manifest);
}

/** One model's INSERT, or `null` when it has no fillable column. */
function modelInsert({
  model,
  view,
  ids,
  schema,
  modelByTable,
  manifest,
}: {
  model: PrismaModel;
  view: DerivedPostgresView;
  ids: SeedIds;
  schema: string;
  modelByTable: ReadonlyMap<string, PrismaModel>;
  manifest: PrismaManifest;
}): string | null {
  const link = tenantLink(view, ids, modelByTable);
  const fkTargets = foreignKeyTargets(model);
  const columns: string[] = [];
  const values: string[] = [];
  for (const field of model.fields) {
    if (field.kind === "relation" || field.kind === "unsupported") continue;
    const value = columnValue({
      field,
      model,
      view,
      link,
      fkTargets,
      ids,
      manifest,
    });
    if (value === OMIT) continue;
    columns.push(quoteIdent(field.columnName));
    values.push(value);
  }
  if (columns.length === 0) return null;
  return (
    `INSERT INTO ${quoteIdent(schema)}.${quoteIdent(model.tableName)} ` +
    `(${columns.join(", ")}) VALUES (${values.join(", ")})`
  );
}

/**
 * Orders models so each comes after every model it references through a NOT NULL foreign
 * key, so the real-FK tables insert cleanly.
 */
function topologicalOrder(models: readonly PrismaModel[]): readonly PrismaModel[] {
  const present = new Set(models.map((model) => model.name));
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const model of models) {
    indegree.set(model.name, 0);
    dependents.set(model.name, []);
  }
  for (const model of models) {
    const fkTargets = foreignKeyTargets(model);
    const edges = new Set<string>();
    for (const field of model.fields) {
      if (field.kind !== "scalar" || field.isOptional || field.isList) continue;
      const target = fkTargets.get(field.name);
      if (!target || target === model.name || !present.has(target)) continue;
      edges.add(target);
    }
    for (const target of edges) {
      dependents.get(target)?.push(model.name);
      indegree.set(model.name, (indegree.get(model.name) ?? 0) + 1);
    }
  }
  const byName = new Map(models.map((model) => [model.name, model]));
  const ready = models
    .filter((model) => (indegree.get(model.name) ?? 0) === 0)
    .map((model) => model.name);
  const ordered: PrismaModel[] = [];
  const emitted = new Set<string>();
  while (ready.length > 0) {
    const name = ready.shift();
    const model = name === undefined ? undefined : byName.get(name);
    if (name === undefined || !model || emitted.has(name)) continue;
    emitted.add(name);
    ordered.push(model);
    for (const dependent of dependents.get(name) ?? []) {
      const next = (indegree.get(dependent) ?? 0) - 1;
      indegree.set(dependent, next);
      if (next === 0) ready.push(dependent);
    }
  }
  // Any model left in a cycle keeps its input position — appended in order.
  for (const model of models) {
    if (!emitted.has(model.name)) ordered.push(model);
  }
  return ordered;
}

/**
 * A column-named `INSERT` for every derived Postgres view's base model that the explicit
 * seeds do not already cover, for one tenant, in dependency order.
 */
export function postgresModelSeedStatements({
  tenantId,
  organizationId,
  teamId,
  userId,
  views,
  manifest,
  alreadySeeded,
  explicitIds,
  schema = "public",
}: {
  tenantId: string;
  organizationId: string;
  teamId: string;
  userId: string;
  views: readonly DerivedPostgresView[];
  manifest: PrismaManifest;
  alreadySeeded: readonly string[];
  explicitIds?: Readonly<Record<string, string>>;
  schema?: string;
}): string[] {
  const ids: SeedIds = {
    tenantId,
    organizationId,
    teamId,
    userId,
    explicitIds,
  };
  const modelByTable = new Map(manifest.models.map((model) => [model.tableName, model]));
  const skipped = new Set(alreadySeeded);

  // One (model, view) pair per model to seed, in view order, deduplicated.
  const seen = new Set<string>();
  const toSeed: { model: PrismaModel; view: DerivedPostgresView }[] = [];
  for (const view of views) {
    if (!view.postgres) continue;
    const model = modelByTable.get(view.postgres.baseRelation);
    if (!model || skipped.has(model.name) || seen.has(model.name)) continue;
    seen.add(model.name);
    toSeed.push({ model, view });
  }

  const viewByModel = new Map(toSeed.map((entry) => [entry.model.name, entry.view]));
  const ordered = topologicalOrder(toSeed.map((entry) => entry.model));

  const statements: string[] = [];
  for (const model of ordered) {
    const view = viewByModel.get(model.name);
    if (!view) continue;
    const insert = modelInsert({
      model,
      view,
      ids,
      schema,
      modelByTable,
      manifest,
    });
    if (insert) statements.push(insert);
  }
  return statements;
}
