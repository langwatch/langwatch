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

import { CAPABILITY_PREFIX, lwqlTenantCapability } from "./capability";
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

/**
 * Whether a stored key-map hash was written by the current derivation.
 *
 * The cost factor is in the stored value, so a row that does not carry this
 * prefix was derived by an older generation of `lwqlTenantCapability` and no
 * longer resolves for its tenant — it has to be re-derived, not trusted.
 */
export function isCurrentGenerationCapability(hash: string): boolean {
  return hash.startsWith(CAPABILITY_PREFIX);
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
  /**
   * Project ids whose `lwqlKey` was present but could not be hashed — today
   * that means a key over bcrypt's 72-byte limit, which the capability refuses
   * rather than silently truncating.
   *
   * Reported per project for the same reason blanks are, and it is why this
   * plan does not simply propagate the rejection: one unusable key must not
   * cost every other project its row. Same consequence as a blank key for the
   * project it names, so the caller logs it just as loudly.
   */
  unhashableProjectIds: string[];
}

/**
 * Diffs every project's key hash against the key-map table's current rows and
 * returns only what is missing. Reads nothing: it takes the already-read
 * existing hash set, and the only work it does is deriving each project's
 * capability.
 *
 * That derivation is a KDF (`../capability.ts`), which is why this is `async`
 * and why the hashes are derived in batches rather than one at a time. Be
 * precise about what that buys: bcrypt's async `hash` occupies a libuv thread,
 * and the pool is four threads by default, so concurrency divides the cost by
 * about four — measured, 4 hashes take as long as 1, and 64 take sixteen times
 * as long. It is a constant factor, not an amortisation. The backfill is still
 * O(projects) in bcrypt time on every deploy, where it used to be
 * microseconds; on a large deployment that is the cost to watch.
 *
 * Duplicate `(hash, tenant)` pairs are harmless at read time (row filters use
 * `HAVING uniqExact(TenantId) = 1`), but this still de-duplicates within one
 * run — inserting a row already covered by `existingHashes`, or repeated
 * inside `projects` itself, buys nothing and only grows the table.
 */
export async function planLwqlKeyMapBackfill({
  projects,
  existingHashes,
  tenantsHoldingCurrentCapability = new Set<string>(),
}: {
  projects: readonly { id: string; lwqlKey: string }[];
  existingHashes: ReadonlySet<string>;
  /**
   * Tenants whose key-map row was already written by *this* generation of the
   * derivation — see {@link CAPABILITY_PREFIX}. Their capability is not
   * re-derived, which is what keeps a steady-state deploy free of bcrypt work
   * entirely instead of paying it per project forever.
   *
   * Deliberately not "every tenant with any row": on the deploy that changes
   * the derivation, every project holds a row from the previous generation and
   * every one of them has to be re-derived. Matching on the current prefix is
   * what makes this an optimisation rather than a way to skip the migration.
   *
   * The assumption it rests on is that a project's `lwqlKey` never changes
   * after it is minted — it is `@unique @default(dbgenerated(...))` with no
   * update path. If a rotation path is ever added it must write the key-map
   * row itself, the way project creation does, because this backfill will no
   * longer notice.
   */
  tenantsHoldingCurrentCapability?: ReadonlySet<string>;
}): Promise<LwqlKeyMapBackfillPlan> {
  const rowsToInsert: LwqlKeyMapRow[] = [];
  const unhashableProjectIds: string[] = [];
  const plannedHashes = new Set<string>();

  // A blank key is reported, never hashed: the capability refuses an empty
  // secret, and this function's contract is to collect those projects rather
  // than throw on the first one. Partitioned before the fan-out so the blank
  // case never has to be re-derived from a missing hash afterwards.
  const keyed = projects.filter(
    (project) =>
      project.lwqlKey && !tenantsHoldingCurrentCapability.has(project.id),
  );
  const blankKeyProjectIds = projects
    .filter((project) => !project.lwqlKey)
    .map((project) => project.id);

  // Batch by batch, awaited in turn: the concurrency bound only exists if the
  // batches are sequential — mapping them all into one `Promise.all` would
  // start every project at once and be exactly the fan-out it is meant to
  // replace. Each project's refusal is caught rather than propagated, because
  // `Promise.all` rejecting on the first one would fail the deploy, insert
  // nothing for anybody, and never name the project at fault; collecting it
  // keeps this function's documented contract for both refusals, not just for
  // blanks.
  for (const batch of chunk(keyed, CAPABILITY_DERIVATION_CONCURRENCY)) {
    const derived = await Promise.all(
      batch.map(async (project) => {
        try {
          return {
            project,
            hash: await lwqlTenantCapability({ secret: project.lwqlKey }),
          };
        } catch {
          return { project, hash: undefined };
        }
      }),
    );

    for (const { project, hash } of derived) {
      if (hash === undefined) {
        unhashableProjectIds.push(project.id);
        continue;
      }
      if (existingHashes.has(hash) || plannedHashes.has(hash)) continue;
      plannedHashes.add(hash);
      rowsToInsert.push({
        [KEY_MAP_COLUMNS.keyHash]: hash,
        [KEY_MAP_COLUMNS.tenantId]: project.id,
      });
    }
  }

  return { rowsToInsert, blankKeyProjectIds, unhashableProjectIds };
}

/**
 * How many capabilities are derived at once.
 *
 * bcrypt's async `hash` runs on the libuv thread pool, which is four threads
 * unless `UV_THREADPOOL_SIZE` says otherwise, so mapping every project at once
 * buys nothing past the fourth and starves the same pool that serves
 * `dns.lookup` — which the ClickHouse and Postgres clients need mid-backfill.
 * Deriving in bounded batches keeps the win and leaves the pool breathing.
 */
const CAPABILITY_DERIVATION_CONCURRENCY = 4;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
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
