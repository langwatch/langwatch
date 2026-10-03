/**
 * Production LangWatchQL provisioning — pure composition only.
 *
 * `accessModel.ts`, `catalogStatements.ts` and `postgresMapping.ts` generate the SQL;
 * this module decides which of it a real deploy runs and in what order, from
 * the runtime `LWQL_*` connection. No I/O happens here — every function
 * takes its inputs as parameters and returns SQL statements, a name, or a
 * plan, so the composition itself is unit-testable without a database.
 * `selfProvisionEntry.ts` is the only caller and the only place that
 * touches a client, an env var beyond what it hands in here, or Postgres.
 *
 * ## What this module composes
 *
 * The application owns the LangWatchQL access model on every deployment and
 * converges the ClickHouse side — restricted user, settings profile, grants,
 * row policies, views — through `selfProvisioning.ts` at boot (ADR-142). What
 * remains here is the PostgreSQL half and the key map: this module composes
 * the PostgreSQL-side approved views
 * ({@link productionPostgresApprovedViewStatements}) and the key-map backfill
 * plan ({@link planLwqlKeyMapBackfill}) that `selfProvisionEntry.ts` runs.
 *
 * @see specs/lwql/api.feature
 */

import { lwqlTenantCapability } from "../capability";
import { LWQL_VIEW_CATALOG } from "../catalog/lwqlViews";
import type { LangWatchQLViewDefinition } from "../catalog/types";
import type { LangWatchQLConnection } from "../connection";
import {
  KEY_MAP_COLUMNS,
  type LangWatchQLNames,
  qualified,
} from "./accessModel";
import { lwqlPostgresApprovedViewStatements } from "./catalogStatements";

/**
 * Literal, hard-coded match for the table name the SaaS row-filter subqueries
 * already reference (see migration 00084). Not derived from `names.database`
 * or any env var — infra's filters name this table by this exact string.
 */
export const LWQL_KEY_MAP_TABLE = "lwql_api_key_tenant_map";

/** PostgreSQL schema the approved views live in when the URL names none. */
export const LWQL_POSTGRES_SCHEMA = "public";

/**
 * The schema the application's tables actually live in, read from the
 * connection URL's `schema` query parameter (the same one Prisma honours).
 *
 * Hardcoding `public` here broke on any deployment whose `DATABASE_URL`
 * carries `?schema=...` — the SaaS cloud runs with `schema=langwatch_db` —
 * because the approved views name their base relations schema-qualified, and
 * `public."Annotation"` does not exist there. The views must be created in,
 * and read from, the schema the tables are in: it is also the schema the
 * infra-owned reader-role bootstrap grants `lwql_%` views in and puts first
 * on the role's `search_path`.
 *
 * Throws on a present-but-unparseable URL rather than defaulting: silently
 * provisioning into `public` on a deployment that meant another schema is
 * the exact failure this function exists to close.
 */
export function lwqlPostgresSchemaFromDatabaseUrl(
  databaseUrl: string | undefined,
): string {
  if (!databaseUrl) return LWQL_POSTGRES_SCHEMA;
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error(
      "lwql provisioning: DATABASE_URL is set but not a parseable URL, cannot determine the PostgreSQL schema for the approved views",
    );
  }
  // `||`, not `??`: a bare `?schema=` means "no schema named", the same way
  // `prismaPgAdapter.ts` reads this URL — not a request for a view named "".
  return url.searchParams.get("schema") || LWQL_POSTGRES_SCHEMA;
}

/**
 * Whether this deploy provisions the ClickHouse access model itself, rather
 * than leaving it to out-of-band infra.
 *
 * Self-provisioning is the DEFAULT everywhere except SaaS. SaaS is the one
 * exception: there the access model stays Terraform-owned, so Terraform is the
 * single writer to that security boundary during incidents, the unprivileged
 * Cloud runtime identity holds no grant-rewriting capability, and the
 * multi-tenant prod app runtime never issues `CREATE USER`/`GRANT`.
 *
 * `LWQL_SELF_PROVISION_ACCESS_MODEL` is an explicit override in both
 * directions, so a SaaS deploy can opt in and a self-hoster with externally
 * managed grants can opt out:
 *
 *  - `"true"`  — always on, even on SaaS
 *  - `"false"` — always off
 *  - unset     — `!isSaas` (on outside SaaS, off on SaaS)
 *
 * Pure by design: takes the override string and the SaaS flag as parameters
 * rather than reading `process.env`/`env`, so the decision is unit-testable
 * without an environment. {@link tasks/provisionLwql.ts} is the only caller and
 * the one place that feeds it the live values.
 */
export function shouldSelfProvisionLwqlAccessModel({
  override,
  isSaas,
}: {
  /** Raw `process.env.LWQL_SELF_PROVISION_ACCESS_MODEL`. */
  override: string | undefined;
  /** `env.IS_SAAS`. */
  isSaas: boolean | undefined;
}): boolean {
  if (override === "true") return true;
  if (override === "false") return false;
  return !isSaas;
}

/**
 * Builds the object names a production deploy provisions under, from the
 * validated `LWQL_*` connection. `settingsProfile` is derived rather than
 * configured, mirroring the test harness's `lwql_${slug}_profile` convention
 * with the production database name standing in for the suite slug.
 */
export function productionLangWatchQLNames({
  connection,
}: {
  connection: LangWatchQLConnection;
}): LangWatchQLNames {
  return {
    database: connection.database,
    restrictedUser: connection.username,
    settingsProfile: `${connection.database}_profile`,
    keyMapTable: LWQL_KEY_MAP_TABLE,
    tenantSetting: connection.tenantSetting,
  };
}

/**
 * The key-map table's qualified name.
 *
 * Always migration 00084's table, created under the app's own ClickHouse
 * database (`sourceDatabase`, matching goose's `${CLICKHOUSE_DATABASE}`) —
 * the same database the row filters already reference. Never `names.database`:
 * this deploy provisions no key-map table of its own; migration 00084 owns it.
 */
export function lwqlKeyMapTableQualifiedName({
  names,
  sourceDatabase,
}: {
  names: LangWatchQLNames;
  sourceDatabase: string;
}): string {
  return qualified(names, names.keyMapTable, sourceDatabase);
}

/**
 * The PostgreSQL-side approved views. Independent of ClickHouse credentials —
 * always runs.
 */
export function productionPostgresApprovedViewStatements({
  schema = LWQL_POSTGRES_SCHEMA,
  views = LWQL_VIEW_CATALOG,
  readerRole,
}: {
  /** From {@link lwqlPostgresSchemaFromDatabaseUrl} in a real deploy. */
  schema?: string;
  views?: readonly LangWatchQLViewDefinition[];
  /**
   * Forwarded to {@link lwqlPostgresApprovedViewStatements} — the reader role
   * whichever mode this boot converges the role under (see
   * `LWQL_POSTGRES_READER_ROLE` and `src/tasks/provisionLwql.ts`).
   */
  readerRole?: string;
} = {}): string[] {
  return lwqlPostgresApprovedViewStatements({
    schema,
    views,
    readerRole,
  });
}

/**
 * The PostgreSQL role the ClickHouse named collection dials as. The app
 * converges it as part of the self-provisioned model (see
 * `selfHostedPostgresReaderStatements`) and grants it read access to the
 * approved views.
 */
export const LWQL_POSTGRES_READER_ROLE = "lwql_ro";

/** One project's key-map row candidate. */
export interface LwqlKeyMapRow {
  KeyHash: string;
  TenantId: string;
}

/** What a backfill run against the current key-map table needs to do. */
export interface LwqlKeyMapBackfillPlan {
  rowsToInsert: LwqlKeyMapRow[];
  /**
   * Project ids whose `lwqlKey` was empty/blank. Never silently dropped: an
   * empty key means that project's LangWatchQL access is unreachable, which
   * is the exact failure this backfill exists to prevent, so the caller must
   * log these loudly rather than skip them quietly.
   */
  blankKeyProjectIds: string[];
}

/**
 * Diffs every project's key hash against the key-map table's current rows and
 * returns only what is missing. Pure: takes the already-read existing hash
 * set, computes no I/O.
 *
 * Duplicate `(hash, tenant)` pairs are harmless at read time (row filters use
 * `HAVING uniqExact(TenantId) = 1`), but this still de-duplicates within one
 * run — inserting a row already covered by `existingHashes`, or repeated
 * inside `projects` itself, buys nothing and only grows the table.
 */
export function planLwqlKeyMapBackfill({
  projects,
  existingHashes,
}: {
  projects: readonly { id: string; lwqlKey: string }[];
  existingHashes: ReadonlySet<string>;
}): LwqlKeyMapBackfillPlan {
  const rowsToInsert: LwqlKeyMapRow[] = [];
  const blankKeyProjectIds: string[] = [];
  const plannedHashes = new Set<string>();

  for (const project of projects) {
    if (!project.lwqlKey) {
      blankKeyProjectIds.push(project.id);
      continue;
    }
    const hash = lwqlTenantCapability({ secret: project.lwqlKey });
    if (existingHashes.has(hash) || plannedHashes.has(hash)) continue;
    plannedHashes.add(hash);
    rowsToInsert.push({
      [KEY_MAP_COLUMNS.keyHash]: hash,
      [KEY_MAP_COLUMNS.tenantId]: project.id,
    });
  }

  return { rowsToInsert, blankKeyProjectIds };
}

/**
 * The sanctioned opt-out `guardProjectId` accepts on a raw PostgreSQL
 * statement that intentionally has no tenancy predicate. Every LangWatchQL
 * provisioning statement run through `prisma.$executeRawUnsafe` needs this:
 * the objects it creates (the approved views) are catalog-wide, not scoped to
 * one tenant.
 */
export function withTenancyOptOut(statement: string): string {
  return `-- @tenancy: provisions LangWatchQL catalog objects shared across every tenant, not scoped to one\n${statement}`;
}
