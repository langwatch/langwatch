/**
 * Production LangWatchQL provisioning — pure composition only.
 *
 * `provisioning.ts`, `views.ts` and `postgresMapping.ts` generate the SQL;
 * this module decides which of it a real deploy runs and in what order, from
 * the runtime `LWQL_*` connection. No I/O happens here — every function
 * takes its inputs as parameters and returns SQL statements, a name, or a
 * plan, so the composition itself is unit-testable without a database.
 * `src/tasks/provisionLwql.ts` is the only caller and the only place that
 * touches a client, an env var beyond what it hands in here, or Postgres.
 *
 * ## What this deploy provisions, and what it does not
 *
 * The ClickHouse access model — restricted user, settings profile, grants,
 * row policies — and the PostgreSQL-mapped views are infra's job: terraform
 * provisions both out of band, against a server-managed identity a
 * `CREATE USER`/`GRANT` issued here would be rejected against. This module
 * therefore composes only three things: the ClickHouse-native views
 * ({@link productionClickHouseObjectStatements}), the PostgreSQL-side
 * approved views ({@link productionPostgresApprovedViewStatements}), and the
 * key-map backfill plan ({@link planLwqlKeyMapBackfill}).
 *
 * @see specs/analytics/lwql-api.feature
 */

import { lwqlTenantCapability } from "./capability";
import { LWQL_VIEW_CATALOG } from "./catalog/lwqlViews";
import type { LangWatchQLViewDefinition } from "./catalog/types";
import { isPostgresResident } from "./catalog/types";
import type { LangWatchQLConnection } from "./executor";
import {
  KEY_MAP_COLUMNS,
  type LangWatchQLNames,
  qualified,
} from "./provisioning";
import { postgresLiteral, postgresQuoted } from "./sqlText";
import {
  lwqlApprovedPostgresViewNames,
  lwqlPostgresApprovedViewStatements,
  lwqlViewStatement,
  SHIPPED_LWQL_DEDUP,
} from "./views";

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
 * the same database infra's row filters already reference. Never
 * `names.database`: this deploy provisions no key-map table of its own (see
 * {@link productionClickHouseObjectStatements}'s doc comment).
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
 * ClickHouse-native views only. Never grants, policies, a user, a profile, or
 * the key-map table (migration 00084 already created it) — the ClickHouse
 * access model and the PostgreSQL-mapped views are infra's job, provisioned
 * out of band (see the module doc comment).
 */
export function productionClickHouseObjectStatements({
  names,
  sourceDatabase,
  views = LWQL_VIEW_CATALOG,
}: {
  names: LangWatchQLNames;
  sourceDatabase: string;
  views?: readonly LangWatchQLViewDefinition[];
}): string[] {
  return [
    `CREATE DATABASE IF NOT EXISTS ${names.database}`,
    ...views
      .filter((view) => !isPostgresResident(view))
      .map((view) =>
        lwqlViewStatement({
          names,
          sourceDatabase,
          view,
          dedup: SHIPPED_LWQL_DEDUP,
        }),
      ),
  ];
}

/**
 * The PostgreSQL-side approved views. Independent of ClickHouse credentials —
 * always runs.
 */
export function productionPostgresApprovedViewStatements({
  schema = LWQL_POSTGRES_SCHEMA,
  views = LWQL_VIEW_CATALOG,
}: {
  /** From {@link lwqlPostgresSchemaFromDatabaseUrl} in a real deploy. */
  schema?: string;
  views?: readonly LangWatchQLViewDefinition[];
} = {}): string[] {
  return lwqlPostgresApprovedViewStatements({
    schema,
    views,
  });
}

/**
 * The PostgreSQL role the ClickHouse named collection dials as. Provisioned
 * out of band (terraform in the cloud, self-provisioning elsewhere); this
 * module only ever grants it read access to views it just created.
 */
export const LWQL_POSTGRES_READER_ROLE = "lwql_ro";

/**
 * Grants the reader role SELECT on every approved view, to be run straight
 * after {@link productionPostgresApprovedViewStatements} creates them.
 *
 * This exists because the two halves are provisioned by different systems on
 * different schedules. Out-of-band provisioning grants the role whatever
 * views exist *at the moment it runs*, and re-runs only when its own inputs
 * change — so a view this task adds later (a new catalog dataset, a first
 * deploy that lands before the grant job) is created with no grant on it, and
 * every query touching it fails `ACCESS_DENIED` until someone re-runs the
 * grant job by hand. Re-granting here on every boot makes the app converge
 * its own views and removes the ordering dependency entirely.
 *
 * Grants only — never `CREATE ROLE`, never a password. This code path holds
 * no reader credential and must not invent one: if the role is absent the
 * whole block is a no-op, so a deployment that has not provisioned the reader
 * yet is unaffected rather than broken.
 */
export function productionPostgresReaderGrantStatements({
  schema = LWQL_POSTGRES_SCHEMA,
  role = LWQL_POSTGRES_READER_ROLE,
  views = LWQL_VIEW_CATALOG,
}: {
  schema?: string;
  role?: string;
  views?: readonly LangWatchQLViewDefinition[];
} = {}): string[] {
  const approvedViews = lwqlApprovedPostgresViewNames(views);
  if (approvedViews.length === 0) return [];

  const quotedSchema = postgresQuoted(schema);
  const quotedRole = postgresQuoted(role);
  const grants = [
    `GRANT USAGE ON SCHEMA ${quotedSchema} TO ${quotedRole}`,
    ...approvedViews.map(
      (view) =>
        `GRANT SELECT ON ${quotedSchema}.${postgresQuoted(view)} TO ${quotedRole}`,
    ),
  ];

  // One guarded block rather than a probe followed by grants: the check and
  // the grants have to be the same statement, or a role dropped between them
  // turns a no-op into a failed deploy.
  return [
    `DO $$\nBEGIN\n` +
      `  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${postgresLiteral(role)}) THEN\n` +
      grants
        .map((grant) => `    EXECUTE ${postgresLiteral(grant)};\n`)
        .join("") +
      `  END IF;\nEND\n$$`,
  ];
}

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
 * returns only what is missing. Reads nothing: it takes the already-read
 * existing hash set, and the only work it does is deriving each project's
 * capability.
 *
 * That derivation is a KDF (`../capability.ts`), which is why this is `async`
 * and why the hashes are derived up front rather than inside the loop — one
 * costs roughly 200ms, so a serial loop would put the whole backfill on the
 * critical path at 200ms a project.
 *
 * Duplicate `(hash, tenant)` pairs are harmless at read time (row filters use
 * `HAVING uniqExact(TenantId) = 1`), but this still de-duplicates within one
 * run — inserting a row already covered by `existingHashes`, or repeated
 * inside `projects` itself, buys nothing and only grows the table.
 */
export async function planLwqlKeyMapBackfill({
  projects,
  existingHashes,
}: {
  projects: readonly { id: string; lwqlKey: string }[];
  existingHashes: ReadonlySet<string>;
}): Promise<LwqlKeyMapBackfillPlan> {
  const rowsToInsert: LwqlKeyMapRow[] = [];
  const blankKeyProjectIds: string[] = [];
  const plannedHashes = new Set<string>();

  // A blank key is reported, never hashed: the capability refuses an empty
  // secret, and this function's contract is to collect those projects rather
  // than throw on the first one.
  const derived = await Promise.all(
    projects.map(async (project) =>
      project.lwqlKey
        ? {
            project,
            hash: await lwqlTenantCapability({ secret: project.lwqlKey }),
          }
        : { project, hash: undefined },
    ),
  );

  for (const { project, hash } of derived) {
    if (hash === undefined) {
      blankKeyProjectIds.push(project.id);
      continue;
    }
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
