/**
 * Seeds one row per derived Postgres view's base model, for one tenant.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * The Postgres half of the catalog is now *derived*: every tenant-scoped Prisma
 * model becomes a view (93 of them). `postgresEngineIsolation.integration.test.ts`
 * proves every one is tenant-scoped by reading its engine table and refusing a
 * table that holds no tenant-a/tenant-b rows. Only the handful of models the
 * harness hand-seeds carry rows, so that proof is vacuous for the ~85 views
 * whose base model no one seeds. This generator fills the gap: it produces a
 * column-named `INSERT` for every derived view's base model that the explicit
 * seeds do not already cover, so the isolation proof has a row it could have
 * leaked for every view.
 *
 * ── HOW A VALUE IS CHOSEN ───────────────────────────────────────────────────
 * The row must (a) resolve to the caller's project through the same join chain
 * the approved view uses, and (b) never let an *excluded* column's data reach
 * the LangWatchQL schema. So:
 *  - the column the view's tenant path starts from (its `projectId`/`teamId`/
 *    `organizationId`, or the foreign key to a parent it reaches a tenant
 *    through) is set to the tenant spine the harness already seeded, so the
 *    join lands on the caller's project;
 *  - a column the derivation *strips* (absent from the view) is given a
 *    recognisable `excluded-…` marker, which is what lets the isolation test
 *    assert a `SELECT *` over the view never contains one;
 *  - a nullable column not covered by any of the above stays SQL `NULL` — the
 *    minimal-row default. Several tables carry a `CHECK` constraint pairing
 *    nullable columns (an enum-discriminated destination shape, a bounded
 *    range); filling every nullable column, as an earlier version of this
 *    seeder did, violates those by construction. `SEED_COLUMN_OVERRIDES`
 *    names the rare exception a `CHECK` constraint forces on a specific
 *    (model, column) pair;
 *  - every other (required) column gets a type-correct filler that carries
 *    the tenant id where it is a string, so unique constraints stay distinct
 *    across tenants.
 *
 * Rows are emitted so a model comes after every model it references, so the
 * ~27 tables that carry a real `FOREIGN KEY` (the schema is otherwise
 * `relationMode = "prisma"`, no database FKs) insert cleanly.
 *
 * @see ./lwqlClickHouseHarness.ts — `postgresTenantSeedStatements` (the explicit seeds this complements) and `startLangWatchQLPostgres` (the caller)
 * @see ../catalog/derivePostgresCatalog.ts — the derivation whose views this seeds
 */

import type { DerivedPostgresView } from "../catalog/derivePostgresCatalog";
import { prismaManifestEnum } from "../catalog/prismaManifest";
import type {
  PrismaField,
  PrismaManifest,
  PrismaModel,
} from "../catalog/prismaSchema";

/**
 * The subset of a derived view this seeder reads, structural to stay decoupled.
 *
 * A supertype of {@link DerivedPostgresView}: `postgres` is optional here to
 * match its `LangWatchQLViewDefinition.postgres?` origin, so the derivation's
 * output feeds this seeder without a cast. The seeder only ever receives real
 * derived views, every one of which carries `postgres`, so the internals read
 * it non-null.
 */
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
  /** Source columns the derivation stripped, mapped to the reason. */
  readonly skipColumns: Readonly<Record<string, string>>;
}

/** A fixed timestamp for every `DateTime` column, matching the explicit seeds. */
const SEED_STAMP = "2026-01-01T00:00:00Z";

/**
 * The primary-key value the explicitly-seeded models carry, so a generic row's
 * foreign key to one of them points at a row that exists.
 *
 * These ids are the ones {@link ./lwqlClickHouseHarness#postgresTenantSeedStatements}
 * writes; a generic model reaching a tenant through `VirtualKey`, or joining a
 * `LlmPromptConfig`, needs the same id the explicit seed used, not the generic
 * `<tenant>-<Model>-1` convention. Kept here rather than imported to avoid a
 * cycle with the harness that consumes this module.
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

/** The id a foreign key targeting `model` should point at, for this tenant. */
function seededId(model: string, tenantId: string): string {
  return EXPLICIT_SEED_ID[model]?.(tenantId) ?? `${tenantId}-${model}-1`;
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
function typeDefault(
  field: PrismaField,
  tenantId: string,
  manifest: PrismaManifest,
): CellValue {
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
  view: SeedableView,
  ids: SeedIds,
  modelByTable: ReadonlyMap<string, PrismaModel>,
): { column: string; value: string } {
  const postgres = view.postgres!;
  const path = postgres.tenantPath ?? [];
  if (path.length === 0) {
    // Project-scoped: the tenant-source column is a real column on the base
    // relation (`projectId`, or `id` on Project itself), set to the project.
    return { column: postgres.tenantSourceColumn, value: ids.tenantId };
  }
  const first = path[0]!;
  if (first.on.from === "teamId")
    return { column: "teamId", value: ids.teamId };
  if (first.on.from === "organizationId") {
    return { column: "organizationId", value: ids.organizationId };
  }
  // Parent scope: the base column holds a foreign key to a parent the tenant is
  // reached through; point it at the parent row's seeded id.
  const parentModel = modelByTable.get(first.relation)?.name ?? first.relation;
  return { column: first.on.from, value: seededId(parentModel, ids.tenantId) };
}

/**
 * Per-(model, column) literal overrides that win over every generic rule in
 * {@link columnValue} below. A CHECK constraint that ties two or more
 * nullable columns to each other (an enum-discriminated shape, a paired
 * credential) can't be satisfied by seeding each column in isolation under
 * the minimal-row default — the override names the exact value that pairing
 * needs. `null` means "seed SQL NULL", never "no override" (absence from the
 * map is what falls through to the generic rules).
 */
const SEED_COLUMN_OVERRIDES: Readonly<
  Record<string, Readonly<Record<string, string | null>>>
> = {
  // `WebhookEndpoint_destination_shape_check`: the seeded `destinationKind`
  // is 'http' (the enum's first value, per `enumDefault`), which requires
  // `url` set and every `sqs*` column null. `sqsAccessKeyId` and
  // `sqsSecretAccessKeyEncrypted` match the secret-column pattern the
  // derivation strips by default, so without this override they would carry
  // the `excluded-…` marker (non-null) instead of null and fail the
  // constraint. The no-leak proof those two columns exist for is instead
  // carried by `secretEncrypted`, which is required (never null under this
  // override) and keeps its own marker.
  WebhookEndpoint: {
    url: quoteLiteral("https://example.com/webhook"),
    sqsQueueUrl: null,
    sqsRoleArn: null,
    sqsExternalId: null,
    sqsAccessKeyId: null,
    sqsSecretAccessKeyEncrypted: null,
  },
};

/** The four ids the harness seeds the tenant spine with. */
interface SeedIds {
  readonly tenantId: string;
  readonly organizationId: string;
  readonly teamId: string;
  readonly userId: string;
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
  view: SeedableView;
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
    return quoteLiteral(seededId(model.name, ids.tenantId));
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
  if (target === "User" || column === "userId" || /ById$/.test(column)) {
    return field.isOptional ? "NULL" : quoteLiteral(ids.userId);
  }
  if (target) {
    return field.isOptional
      ? "NULL"
      : quoteLiteral(seededId(target, ids.tenantId));
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

  // 5. Minimal-row default: a nullable column with no tenant/PK/FK/strip
  // meaning stays null. A CHECK constraint that ties nullable columns
  // together (an enum-discriminated shape, a paired credential, a bounded
  // range) is then satisfied by construction rather than by accident — the
  // alternative, filling every nullable column, is exactly what broke
  // `WebhookEndpoint_destination_shape_check`. Anything required still gets
  // a type-correct filler.
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
  view: SeedableView;
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
 * Orders models so each comes after every model it references through a NOT
 * NULL foreign key, so the real-FK tables insert cleanly.
 *
 * Only NOT NULL references to *other models in this same set* constrain the
 * order — a nullable FK is seeded null, and a reference to the pre-seeded
 * tenant spine is already present. A cycle (none exists among NOT NULL edges
 * today) falls back to the input order for the models it involves.
 */
function topologicalOrder(
  models: readonly PrismaModel[],
): readonly PrismaModel[] {
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
      dependents.get(target)!.push(model.name);
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
    const name = ready.shift()!;
    if (emitted.has(name)) continue;
    emitted.add(name);
    ordered.push(byName.get(name)!);
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
 * A column-named `INSERT` for every derived Postgres view's base model that the
 * explicit seeds do not already cover, for one tenant, in dependency order.
 *
 * @param tenantId — the caller's project id (`Project.id`); every string value
 *   carries it so unique constraints stay distinct across tenants
 * @param organizationId, teamId, userId — the rest of the tenant spine the
 *   harness seeded, so a fanned-out view's join lands on this tenant's project
 * @param views — the derived views (carrying `skipColumns`); their base models
 *   are what gets seeded
 * @param manifest — the model/field facts every value is built from
 * @param alreadySeeded — model names the explicit seeds cover, skipped here
 */
export function postgresModelSeedStatements({
  tenantId,
  organizationId,
  teamId,
  userId,
  views,
  manifest,
  alreadySeeded,
  schema = "public",
}: {
  tenantId: string;
  organizationId: string;
  teamId: string;
  userId: string;
  views: readonly DerivedPostgresView[];
  manifest: PrismaManifest;
  alreadySeeded: readonly string[];
  schema?: string;
}): string[] {
  const ids: SeedIds = { tenantId, organizationId, teamId, userId };
  const modelByTable = new Map(
    manifest.models.map((model) => [model.tableName, model]),
  );
  const skipped = new Set(alreadySeeded);

  // One (model, view) pair per model to seed, in view order, deduplicated.
  const seen = new Set<string>();
  const toSeed: { model: PrismaModel; view: SeedableView }[] = [];
  for (const view of views) {
    if (!view.postgres) continue;
    const model = modelByTable.get(view.postgres.baseRelation);
    if (!model || skipped.has(model.name) || seen.has(model.name)) continue;
    seen.add(model.name);
    toSeed.push({ model, view });
  }

  const viewByModel = new Map(
    toSeed.map((entry) => [entry.model.name, entry.view]),
  );
  const ordered = topologicalOrder(toSeed.map((entry) => entry.model));

  const statements: string[] = [];
  for (const model of ordered) {
    const view = viewByModel.get(model.name)!;
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
