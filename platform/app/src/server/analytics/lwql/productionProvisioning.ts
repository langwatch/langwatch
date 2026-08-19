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
import {
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

/** PostgreSQL schema the approved views live in. */
export const LWQL_POSTGRES_SCHEMA = "public";

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
  views = LWQL_VIEW_CATALOG,
}: {
  views?: readonly LangWatchQLViewDefinition[];
} = {}): string[] {
  return lwqlPostgresApprovedViewStatements({
    schema: LWQL_POSTGRES_SCHEMA,
    views,
  });
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
    } as LwqlKeyMapRow);
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
