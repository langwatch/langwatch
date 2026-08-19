/**
 * Production LangWatchQL provisioning — pure composition only.
 *
 * `provisioning.ts`, `views.ts` and `postgresMapping.ts` generate the SQL;
 * this module decides which of it a real deploy runs and in what order, from
 * the runtime `LWQL_*` connection plus mode flag. No I/O happens here — every
 * function takes its inputs as parameters and returns SQL statements, a name,
 * or a plan, so the composition itself is unit-testable without a database.
 * `src/tasks/provisionLwql.ts` is the only caller and the only place that
 * touches a client, an env var beyond what it hands in here, or Postgres.
 *
 * ## Mode split
 *
 * DEFAULT (SaaS): the ClickHouse access model — restricted user, settings
 * profile, grants, row policies — and the source-table row filters are
 * provisioned by infra out of band (terraform/XML); a `CREATE USER`/`GRANT`
 * issued here against an XML-defined identity is rejected. This mode
 * therefore creates ClickHouse-native views only
 * ({@link productionClickHouseObjectStatements}), and skips the
 * PostgreSQL-mapped views entirely: mapping them needs a ClickHouse named
 * collection whose `user`/`password` must equal a PostgreSQL reader role's
 * credentials, and nothing in this mode provisions that role or exposes its
 * password — doing so is `LWQL_PROVISION_ACCESS_MODEL=true`'s job. The
 * PostgreSQL-side approved views ({@link productionPostgresApprovedViewStatements})
 * are independent of any of this and always run.
 *
 * FULL (`LWQL_PROVISION_ACCESS_MODEL=true`, self-hosted): this deploy owns
 * the whole access model, so
 * {@link productionClickHouseAccessModelStatements} additionally runs the
 * user/profile/grants/policies and the PostgreSQL-mapped views, using a
 * PostgreSQL reader role this same run provisions
 * ({@link productionPostgresReaderRoleStatements}).
 *
 * @see specs/analytics/lwql-api.feature
 */

import { lwqlTenantCapability } from "./capability";
import { LWQL_VIEW_CATALOG } from "./catalog/lwqlViews";
import type { LangWatchQLViewDefinition } from "./catalog/types";
import { isPostgresResident } from "./catalog/types";
import type { LangWatchQLConnection } from "./executor";
import {
  DEFAULT_POSTGRES_READER_LIMITS,
  type PostgresNamedCollection,
  postgresNamedCollectionStatements,
  postgresReaderRoleStatements,
} from "./postgresMapping";
import {
  KEY_MAP_COLUMNS,
  type LangWatchQLNames,
  lwqlClickHouseSetupStatements,
  qualified,
} from "./provisioning";
import {
  lwqlApprovedPostgresViewNames,
  lwqlPostgresApprovedViewStatements,
  lwqlPostgresEngineTableStatements,
  lwqlPostgresReaderConnectionLimit,
  lwqlViewSetupStatements,
  lwqlViewStatement,
  SHIPPED_LWQL_DEDUP,
} from "./views";

/**
 * Literal, hard-coded match for the table name the SaaS row-filter subqueries
 * already reference (see migration 00083). Not derived from `names.database`
 * or any env var — infra's filters name this table by this exact string.
 */
export const LWQL_KEY_MAP_TABLE = "lwql_api_key_tenant_map";

/** PostgreSQL schema the approved views and reader role live in. */
export const LWQL_POSTGRES_SCHEMA = "public";

/** The PostgreSQL role the named collection authenticates as, full mode only. */
export const LWQL_POSTGRES_READER_ROLE = "lwql_postgres_reader";

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
 * The key-map table's qualified name — NOT always `names.database`.
 *
 * DEFAULT/SaaS mode never provisions this table (see
 * {@link productionClickHouseObjectStatements}'s doc comment below): it is
 * migration 00083's table, created under the app's own ClickHouse database
 * (`sourceDatabase`, matching goose's `${CLICKHOUSE_DATABASE}`) — the same
 * database infra's row filters already reference. FULL mode instead
 * provisions its own copy via {@link productionClickHouseAccessModelStatements}
 * (through `lwqlClickHouseSetupStatements`, which only ever receives `names`
 * — it has no `sourceDatabase` parameter at all), always under
 * `names.database`; the row policy that function creates on the key-map
 * table itself is likewise pinned to `names.database` with no override, so a
 * full-mode backfill must match it or that policy's own subquery would never
 * see the rows this backfill writes.
 */
export function lwqlKeyMapTableQualifiedName({
  names,
  sourceDatabase,
  fullMode,
}: {
  names: LangWatchQLNames;
  sourceDatabase: string;
  fullMode: boolean;
}): string {
  return fullMode
    ? qualified(names, names.keyMapTable)
    : qualified(names, names.keyMapTable, sourceDatabase);
}

/**
 * DEFAULT/SaaS mode: ClickHouse-native views only, no grants, no policies, no
 * user, no profile, no key-map table (migration 00083 already created it).
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
 * FULL/self-hosted mode: the whole ClickHouse access model plus every view
 * (native and PostgreSQL-mapped), correctly column-scoped.
 *
 * `restrictedUserPassword` must be `LWQL_CLICKHOUSE_PASSWORD` (the connection
 * the query-time executor authenticates with) — `CREATE USER OR REPLACE`
 * converges to whatever password is passed here on every run, so passing
 * anything else silently rotates the live credential out from under the
 * query path. `postgresConnection` must carry the same password this run
 * gave {@link productionPostgresReaderRoleStatements}'s role.
 */
export function productionClickHouseAccessModelStatements({
  names,
  sourceDatabase,
  restrictedUserPassword,
  postgresConnection,
  views = LWQL_VIEW_CATALOG,
}: {
  names: LangWatchQLNames;
  sourceDatabase: string;
  restrictedUserPassword: string;
  postgresConnection: PostgresNamedCollection;
  views?: readonly LangWatchQLViewDefinition[];
}): string[] {
  return [
    // `lwqlClickHouseSetupStatements` already emits its own
    // `CREATE DATABASE IF NOT EXISTS ${names.database}` as its first
    // statement — no need to duplicate it here.
    ...lwqlClickHouseSetupStatements({
      names,
      password: restrictedUserPassword,
      lwqlTables: [],
    }),
    ...postgresNamedCollectionStatements({ connection: postgresConnection }),
    ...lwqlPostgresEngineTableStatements({
      names,
      collection: postgresConnection.collection,
      views,
    }),
    ...lwqlViewSetupStatements({
      names,
      sourceDatabase,
      views,
      dedup: SHIPPED_LWQL_DEDUP,
    }),
  ];
}

/**
 * The PostgreSQL-side approved views. Independent of ClickHouse credentials
 * or mode — runs in both DEFAULT and FULL mode.
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

/**
 * The dedicated PostgreSQL reader role, full mode only. `connectionLimit` is
 * derived from the catalog ({@link lwqlPostgresReaderConnectionLimit}) rather
 * than the single-table floor in `DEFAULT_POSTGRES_READER_LIMITS`, so adding
 * a mapped dataset raises the cap instead of exhausting it.
 */
export function productionPostgresReaderRoleStatements({
  password,
  views = LWQL_VIEW_CATALOG,
}: {
  password: string;
  views?: readonly LangWatchQLViewDefinition[];
}): string[] {
  return postgresReaderRoleStatements({
    reader: {
      role: LWQL_POSTGRES_READER_ROLE,
      password,
      schema: LWQL_POSTGRES_SCHEMA,
      approvedViews: lwqlApprovedPostgresViewNames(views),
      connectionLimit: lwqlPostgresReaderConnectionLimit({ views }),
      statementTimeout: DEFAULT_POSTGRES_READER_LIMITS.statementTimeout,
    },
  });
}

/** Host/port/database this deploy's own PostgreSQL connection resolves to. */
export interface AppPostgresConnection {
  host: string;
  port: number;
  database: string;
}

/**
 * Parses the app's own `DATABASE_URL` for the named collection's connection
 * target. There is no dedicated `LWQL_POSTGRES_*` variable: full mode maps
 * the app's own PostgreSQL, the same database `prisma` already connects to,
 * so the named collection points at it too rather than a second declared
 * target that could drift from the real one.
 */
export function parseAppPostgresConnection({
  databaseUrl = process.env.DATABASE_URL,
}: {
  databaseUrl?: string;
} = {}): AppPostgresConnection {
  if (!databaseUrl) {
    throw new Error(
      "lwql provisioning: DATABASE_URL is not set — required in full mode to map PostgreSQL-resident LangWatchQL views into ClickHouse",
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error(
      "lwql provisioning: DATABASE_URL is not a valid connection URL",
    );
  }
  const database = parsed.pathname.replace(/^\//, "");
  if (!database) {
    throw new Error(
      "lwql provisioning: DATABASE_URL has no database name in its path",
    );
  }
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 5432,
    database,
  };
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
 * the objects it creates (approved views, the reader role) are catalog-wide,
 * not scoped to one tenant.
 */
export function withTenancyOptOut(statement: string): string {
  return `-- @tenancy: provisions LangWatchQL catalog objects shared across every tenant, not scoped to one\n${statement}`;
}
