/**
 * Governed analytics SQL — database-side provisioning.
 *
 * The governed SQL API hands customer-written ClickHouse SQL to a single shared
 * database identity. Everything that makes that safe lives here, as SQL text,
 * so the isolation proof suite can apply the *shipped* statements to a container
 * rather than a hand-copied fixture of them. A guard that reads its own copy of
 * the configuration it guards can never disagree with it.
 *
 * The model has four moving parts:
 *
 *  1. A settings profile that pins `readonly = 1` and the resource ceilings as
 *     `CONST`, and declares exactly one setting the caller may change:
 *     the tenant capability.
 *  2. A restricted user carrying that profile, granted `SELECT` and nothing
 *     else on the governed objects.
 *  3. A key-map table mapping an API-key *hash* to the tenant it authorizes.
 *     The raw key never reaches ClickHouse.
 *  4. One row policy per governed object, resolving the tenant through that
 *     key map keyed on the per-query setting — plus a self-policy on the key map
 *     itself, so the reader can only ever see its own row.
 *
 * The tenant context travels per query as the custom setting named by
 * {@link GovernedSqlNames.tenantSetting}. Because the profile declares it with a
 * default of `''` and no key map row has an empty hash, a caller who sends
 * nothing reads nothing: the model fails closed by construction rather than by
 * a check somewhere in the gateway.
 *
 * Two server-level prerequisites are NOT expressible in SQL and ship as XML —
 * see {@link CLICKHOUSE_CUSTOM_SETTINGS_PREFIX_CONFIG_XML} and
 * {@link clickHouseAccessManagementConfigXml}. Without the first, every
 * statement here fails with UNKNOWN_SETTING (115).
 *
 * Every name emitted below is interpolated into SQL text, so it goes through
 * `./sqlText.ts`: `assertIdentifier` on the ClickHouse side, `postgresQuoted`
 * on the PostgreSQL side, and the literal escapers for values.
 *
 * @see ./sqlText.ts — the escaping and identifier rules these statements obey
 * @see specs/analytics/governed-sql-api.feature
 */

import {
  assertIdentifier,
  clickHouseLiteral,
  postgresLiteral,
  postgresQuoted,
} from "./sqlText";

/**
 * Server-level ClickHouse config declaring the `custom_` settings prefix.
 *
 * A deployment prerequisite, not an optimisation: without it ClickHouse rejects
 * the settings profile below with
 * `Setting custom_api_key_hash is neither a builtin setting nor started with
 * the prefix 'SQL_'` (UNKNOWN_SETTING, 115), and no part of the model can be
 * created. Belongs at {@link CLICKHOUSE_CUSTOM_SETTINGS_PREFIX_CONFIG_PATH}.
 */
export const CLICKHOUSE_CUSTOM_SETTINGS_PREFIX_CONFIG_XML = `<clickhouse>
    <custom_settings_prefixes>custom_</custom_settings_prefixes>
</clickhouse>
`;

/** Where {@link CLICKHOUSE_CUSTOM_SETTINGS_PREFIX_CONFIG_XML} must be installed. */
export const CLICKHOUSE_CUSTOM_SETTINGS_PREFIX_CONFIG_PATH =
  "/etc/clickhouse-server/config.d/custom-settings-prefix.xml";

/**
 * Server-level ClickHouse config granting the *administrative* user the right
 * to create users, profiles, row policies and named collections through SQL.
 *
 * Parameterized by user name rather than hardcoded to `default`, because the
 * administrative account is not always `default`: the official image's
 * entrypoint replaces `default` with whatever `CLICKHOUSE_USER` names, so a
 * config addressing `default` silently applies to nobody.
 *
 * Nothing here widens what the restricted identity can do — it must never
 * carry these. Belongs at {@link CLICKHOUSE_ACCESS_MANAGEMENT_CONFIG_PATH}.
 */
export function clickHouseAccessManagementConfigXml({
  administrativeUser,
}: {
  administrativeUser: string;
}): string {
  assertIdentifier(administrativeUser, "administrativeUser");
  return `<clickhouse>
    <users>
        <${administrativeUser}>
            <access_management>1</access_management>
            <named_collection_control>1</named_collection_control>
            <show_named_collections>1</show_named_collections>
            <show_named_collections_secrets>1</show_named_collections_secrets>
        </${administrativeUser}>
    </users>
</clickhouse>
`;
}

/**
 * Where {@link clickHouseAccessManagementConfigXml} must be installed.
 *
 * The `zz-` prefix is load-bearing, not decoration. ClickHouse merges
 * `users.d/*.xml` in lexicographic order and the later file wins, while the
 * official image's entrypoint writes `users.d/default-user.xml` declaring
 * `<access_management>0</access_management>` for that same user. A file named
 * `access-management.xml` sorts *before* it and is silently overridden, leaving
 * the administrative user unable to create any of the objects below.
 */
export const CLICKHOUSE_ACCESS_MANAGEMENT_CONFIG_PATH =
  "/etc/clickhouse-server/users.d/zz-governed-sql-access-management.xml";

/** Column names of the key-map table, which this module owns end to end. */
export const KEY_MAP_COLUMNS = {
  /** Hash of the caller's API key. The raw key is never stored or sent. */
  keyHash: "KeyHash",
  /** Tenant the hash authorizes. */
  tenantId: "TenantId",
} as const;

/** Names of the governed objects, so a deployment can rename without a fork. */
export interface GovernedSqlNames {
  /** Database holding every governed object. */
  database: string;
  /** The shared restricted identity every governed query executes as. */
  restrictedUser: string;
  /** Settings profile pinning readonly and the resource ceilings. */
  settingsProfile: string;
  /** Table (in `database`) mapping an API-key hash to its tenant. */
  keyMapTable: string;
  /**
   * Custom setting carrying the per-query tenant capability. Must start with
   * `custom_` to match {@link CLICKHOUSE_CUSTOM_SETTINGS_PREFIX_CONFIG_XML}.
   */
  tenantSetting: string;
}

/** A governed object and the column its row policy filters on. */
export interface GovernedTable {
  /** Table name within {@link GovernedTable.database}. */
  table: string;
  /** Column holding the owning tenant id. */
  tenantColumn: string;
  /**
   * Database holding the table. Defaults to {@link GovernedSqlNames.database}.
   *
   * The governed views are normal `INVOKER` views, so the row policy that
   * bounds them has to sit on the *source* table — which lives in the
   * application's own database, not the governed one. Everything created
   * directly in the governed database omits this.
   */
  database?: string;
}

/**
 * Ceilings pinned `CONST` by the profile.
 *
 * Belt and braces rather than the load-bearing control: `readonly = 1` already
 * rejects *every* setting change except the tenant capability, including
 * settings the profile never mentions. The `CONST` pins survive any future
 * relaxation of `readonly`.
 */
export interface GovernedResourceLimits {
  maxExecutionTimeSeconds: number;
  maxMemoryUsageBytes: number;
}

/** Measured working against `clickhouse/clickhouse-server:25.10.2.65`. */
export const DEFAULT_GOVERNED_RESOURCE_LIMITS: GovernedResourceLimits = {
  maxExecutionTimeSeconds: 10,
  maxMemoryUsageBytes: 1_000_000_000,
};

function assertNames(names: GovernedSqlNames): GovernedSqlNames {
  assertIdentifier(names.database, "database");
  assertIdentifier(names.restrictedUser, "restrictedUser");
  assertIdentifier(names.settingsProfile, "settingsProfile");
  assertIdentifier(names.keyMapTable, "keyMapTable");
  assertIdentifier(names.tenantSetting, "tenantSetting");
  if (!names.tenantSetting.startsWith("custom_")) {
    throw new Error(
      `governed-sql provisioning: tenantSetting must start with "custom_" to match the declared ` +
        `custom_settings_prefixes, got "${names.tenantSetting}"`,
    );
  }
  return names;
}

/** `database.table`, both validated. */
function qualified(
  names: GovernedSqlNames,
  table: string,
  database?: string,
): string {
  const owner = database ?? names.database;
  return `${assertIdentifier(owner, "database")}.${assertIdentifier(table, "table")}`;
}

/**
 * The key-map table: `KeyHash` to `TenantId`, one row per live API key.
 *
 * Deliberately a table rather than a ClickHouse dictionary. A dictionary form
 * (`dictGetOrDefault(...)` inside the policy) requires granting `dictGet` on the
 * dictionary to the restricted identity, which turns that identity into an
 * oracle: measured against 25.10.2.65,
 * `SELECT dictGetOrDefault('analytics.api_key_dict','TenantId',tuple('hash-b'),'MISS')`
 * answered `tenant-b` — the reader can probe any hash it can guess and learn
 * which tenant it belongs to. The self-policed table has no such oracle
 * (`SELECT count() FROM <key map> WHERE KeyHash='hash-b'` returns 0) and
 * revokes instantly, with none of a dictionary's `LIFETIME` refresh lag.
 */
export function governedKeyMapTableStatement({
  names,
}: {
  names: GovernedSqlNames;
}): string {
  assertNames(names);
  return (
    `CREATE TABLE IF NOT EXISTS ${qualified(names, names.keyMapTable)} ` +
    `(${KEY_MAP_COLUMNS.keyHash} String, ${KEY_MAP_COLUMNS.tenantId} String) ` +
    `ENGINE = MergeTree ORDER BY ${KEY_MAP_COLUMNS.keyHash}`
  );
}

/**
 * The settings profile.
 *
 * The tenant capability is the single `CHANGEABLE_IN_READONLY` setting, and its
 * default of `''` is what makes an absent context read zero rows instead of all
 * rows. Everything else is `CONST`.
 */
export function governedSettingsProfileStatement({
  names,
  limits = DEFAULT_GOVERNED_RESOURCE_LIMITS,
}: {
  names: GovernedSqlNames;
  limits?: GovernedResourceLimits;
}): string {
  assertNames(names);
  return (
    `CREATE SETTINGS PROFILE OR REPLACE ${names.settingsProfile}\n` +
    `  SETTINGS ${names.tenantSetting} = '' CHANGEABLE_IN_READONLY,\n` +
    `           readonly = 1 CONST,\n` +
    `           max_execution_time = ${limits.maxExecutionTimeSeconds} CONST,\n` +
    `           max_memory_usage = ${limits.maxMemoryUsageBytes} CONST`
  );
}

/**
 * The shared restricted identity, carrying the profile and nothing else.
 *
 * `sha256_password` rather than `plaintext_password`, because the two differ
 * only in what ClickHouse keeps at rest: the wire is identical — the client
 * sends the password and the server hashes it to compare — so nothing about the
 * connection changes, while `plaintext_password` would leave the credential
 * recoverable in the access storage and in `SHOW CREATE USER` for anyone who
 * reaches the server as an administrator. This identity is shared by every
 * governed query, so a recovered password is a foothold on all of them.
 */
export function governedRestrictedUserStatement({
  names,
  password,
}: {
  names: GovernedSqlNames;
  password: string;
}): string {
  assertNames(names);
  return (
    `CREATE USER OR REPLACE ${names.restrictedUser} ` +
    `IDENTIFIED WITH sha256_password BY ${clickHouseLiteral(password)} ` +
    `SETTINGS PROFILE ${names.settingsProfile}`
  );
}

/**
 * `SELECT` on one governed object, every column. The identity is granted
 * nothing else.
 *
 * Whole-object rather than column-scoped, because the objects granted this way
 * are the governed views themselves and the key map — things whose entire
 * column list is the exposed surface by construction. Source tables are granted
 * column by column instead; see `governedSourceColumnGrantStatement`.
 */
export function governedGrantStatement({
  names,
  table,
  database,
}: {
  names: GovernedSqlNames;
  table: string;
  /** Defaults to {@link GovernedSqlNames.database}. */
  database?: string;
}): string {
  assertNames(names);
  return `GRANT SELECT ON ${qualified(names, table, database)} TO ${names.restrictedUser}`;
}

/**
 * The `USING` expression every governed row policy shares: the row's tenant
 * must be the one this request's key hash maps to.
 */
function tenantPredicate({
  names,
  tenantColumn,
}: {
  names: GovernedSqlNames;
  tenantColumn: string;
}): string {
  return (
    `${assertIdentifier(tenantColumn, "tenantColumn")} IN (` +
    `SELECT ${KEY_MAP_COLUMNS.tenantId} FROM ${qualified(names, names.keyMapTable)} ` +
    `WHERE ${KEY_MAP_COLUMNS.keyHash} = getSetting(${clickHouseLiteral(names.tenantSetting)}))`
  );
}

/** Policy name for a governed object, derived so it is stable across runs. */
function policyName(table: string): string {
  return `${assertIdentifier(table, "table")}_tenant`;
}

/** Policy name of the key map's self-policy. */
function keyMapPolicyName(keyMapTable: string): string {
  return `${assertIdentifier(keyMapTable, "keyMapTable")}_self`;
}

/**
 * The key map polices itself: the restricted identity sees exactly the row its
 * own hash matches, so it can neither enumerate other tenants' hashes nor
 * confirm a guessed one.
 */
export function governedKeyMapRowPolicyStatement({
  names,
}: {
  names: GovernedSqlNames;
}): string {
  assertNames(names);
  return (
    `CREATE ROW POLICY OR REPLACE ${keyMapPolicyName(names.keyMapTable)} ` +
    `ON ${qualified(names, names.keyMapTable)}\n` +
    `  USING ${KEY_MAP_COLUMNS.keyHash} = getSetting(${clickHouseLiteral(names.tenantSetting)})\n` +
    `  TO ${names.restrictedUser}`
  );
}

/**
 * One row policy per governed object.
 *
 * ClickHouse applies row policies before any user predicate and inside every
 * query shape — CTE, `UNION ALL`, both join sides, subqueries, and `merge()` —
 * so the policy, not the submitted SQL, is what bounds the read.
 */
export function governedRowPolicyStatement({
  names,
  governedTable,
}: {
  names: GovernedSqlNames;
  governedTable: GovernedTable;
}): string {
  assertNames(names);
  return (
    `CREATE ROW POLICY OR REPLACE ${policyName(governedTable.table)} ` +
    `ON ${qualified(names, governedTable.table, governedTable.database)}\n` +
    `  USING ${tenantPredicate({ names, tenantColumn: governedTable.tenantColumn })}\n` +
    `  TO ${names.restrictedUser}`
  );
}

/** Drops one governed object's row policy. Used to prove the policy is load-bearing. */
export function dropGovernedRowPolicyStatement({
  names,
  table,
  database,
}: {
  names: GovernedSqlNames;
  table: string;
  /** Defaults to {@link GovernedSqlNames.database}. */
  database?: string;
}): string {
  assertNames(names);
  return `DROP ROW POLICY IF EXISTS ${policyName(table)} ON ${qualified(names, table, database)}`;
}

/**
 * Every statement that provisions the governed access model, in dependency
 * order.
 *
 * Order is load-bearing, not cosmetic: `CREATE USER OR REPLACE` mints a new
 * access-entity id, so any grant or policy created before it would still point
 * at the replaced user. Grants and policies must always follow the user.
 *
 * The governed objects themselves (fact tables, PostgreSQL-engine tables) are
 * NOT created here — they come from migrations and from the PG mapping. This
 * function provisions only the access model over them.
 */
export function governedClickHouseSetupStatements({
  names,
  password,
  governedTables,
  limits = DEFAULT_GOVERNED_RESOURCE_LIMITS,
}: {
  names: GovernedSqlNames;
  password: string;
  governedTables: GovernedTable[];
  limits?: GovernedResourceLimits;
}): string[] {
  assertNames(names);
  return [
    `CREATE DATABASE IF NOT EXISTS ${names.database}`,
    governedKeyMapTableStatement({ names }),
    governedSettingsProfileStatement({ names, limits }),
    governedRestrictedUserStatement({ names, password }),
    governedGrantStatement({ names, table: names.keyMapTable }),
    ...governedTables.map((governedTable) =>
      governedGrantStatement({ names, table: governedTable.table }),
    ),
    governedKeyMapRowPolicyStatement({ names }),
    ...governedTables.map((governedTable) =>
      governedRowPolicyStatement({ names, governedTable }),
    ),
  ];
}

/**
 * Audits the governed database for views that would void the model.
 *
 * A view declared `SQL SECURITY DEFINER` reads its source tables as its definer,
 * not as the caller, so row policies do not apply to it. Measured against
 * 25.10.2.65: a `DEFINER` view over a policed table returned *both* tenants'
 * rows to the restricted identity. No governed view may be `DEFINER`, and a
 * `MATERIALIZED VIEW` defaults to `DEFINER`, so both are reported.
 *
 * Returns rows of `{ name, engine, create_table_query }` for every offending
 * view; an empty result is the healthy state. Run as an administrative user —
 * the restricted identity cannot read `system.tables` beyond its own grants.
 */
export function definerViewAuditQuery({
  names,
}: {
  names: GovernedSqlNames;
}): string {
  assertNames(names);
  return (
    `SELECT name, engine, create_table_query\n` +
    `FROM system.tables\n` +
    `WHERE database = ${clickHouseLiteral(names.database)}\n` +
    `  AND engine LIKE '%View'\n` +
    `  AND (positionCaseInsensitive(create_table_query, 'SQL SECURITY DEFINER') > 0\n` +
    `       OR engine = 'MaterializedView')`
  );
}

/**
 * Audits row-policy coverage from the server rather than from a hand-written
 * list: every object the restricted identity holds a `SELECT` grant on must be
 * scoped to one tenant, in one of exactly two ways.
 *
 * Grants are the definition of "exposed", so adding a governed object and
 * granting it without scoping it turns this red with no test edit. Deliberately
 * spans every database rather than only the governed one: the governed views
 * are `INVOKER` views over the application's own fact tables, so the grants
 * that matter most sit *outside* the governed database, and an audit scoped to
 * that database would have reported a clean server while the real exposure went
 * unexamined.
 *
 * The two ways an object can be scoped:
 *
 *  - `has_policy` — a row policy on the object itself, applying to this
 *    identity. Every source table.
 *  - `is_invoker_view` — a normal view carrying an explicit
 *    `SQL SECURITY INVOKER`, which reads its sources as the caller and is
 *    therefore bounded by *their* policies. The carve-out is tight on purpose:
 *    a `DEFINER` view has no such clause and a `MATERIALIZED VIEW` is a
 *    different engine, so neither qualifies, and both are separately reported
 *    by {@link definerViewAuditQuery}.
 *
 * Intersected with `system.tables` on purpose: measured against 25.10.2.65, a
 * `SELECT` grant OUTLIVES the `DROP TABLE` of its object, so grants alone would
 * report long-dead objects as uncovered exposure. An object that no longer
 * exists exposes nothing.
 *
 * Returns rows of `{ database, table, has_policy, is_invoker_view, covered }`,
 * each flag being ClickHouse's UInt8 0/1. Run as an administrative user.
 */
export function governedPolicyCoverageQuery({
  names,
}: {
  names: GovernedSqlNames;
}): string {
  assertNames(names);
  const user = clickHouseLiteral(names.restrictedUser);
  return (
    `SELECT\n` +
    `  t.database AS database,\n` +
    `  t.name AS table,\n` +
    `  (t.database, t.name) IN (\n` +
    `    SELECT database, table FROM system.row_policies\n` +
    `    WHERE has(apply_to_list, ${user})\n` +
    `  ) AS has_policy,\n` +
    `  (t.engine = 'View'\n` +
    `   AND positionCaseInsensitive(t.create_table_query, 'SQL SECURITY INVOKER') > 0) AS is_invoker_view,\n` +
    `  (has_policy OR is_invoker_view) AS covered\n` +
    `FROM system.tables AS t\n` +
    `WHERE (t.database, t.name) IN (\n` +
    `    SELECT database, table FROM system.grants\n` +
    `    WHERE user_name = ${user}\n` +
    `      AND access_type = 'SELECT'\n` +
    `      AND database IS NOT NULL\n` +
    `      AND table IS NOT NULL\n` +
    `  )\n` +
    `ORDER BY database, table`
  );
}

/**
 * How ClickHouse renders a custom setting's value when it is read back from
 * `system.settings` or from `system.query_log.Settings`.
 *
 * Measured against 25.10.2.65: both surfaces return the *field-dumped* form —
 * `'0f1e2d…'`, single quotes included — not the bare value that was sent. An
 * audit that compares those columns against the raw hash silently never
 * matches, and reads as "the hash was not recorded".
 *
 * Correct for the hex digests this model uses; a value containing a quote or a
 * backslash would additionally be escaped by the dump.
 */
export function auditedSettingValue(value: string): string {
  return `'${value}'`;
}

/**
 * Audits that no dictionary in the governed database serves tenant-scoped data.
 *
 * Dictionaries are not subject to row policies, so any tenant-scoped dictionary
 * reachable by the restricted identity is a bypass — the reason the key map is
 * a self-policed table. See {@link governedKeyMapTableStatement}.
 *
 * Returns rows of `{ name }`; an empty result is the healthy state.
 */
export function governedDictionaryAuditQuery({
  names,
}: {
  names: GovernedSqlNames;
}): string {
  assertNames(names);
  return (
    `SELECT name FROM system.dictionaries ` +
    `WHERE database = ${clickHouseLiteral(names.database)}`
  );
}

// ---------------------------------------------------------------------------
// PostgreSQL-resident data, reached through server-side named collections
// ---------------------------------------------------------------------------

/** Connection details of the named collection ClickHouse dials PostgreSQL with. */
export interface PostgresNamedCollection {
  /** Collection name, referenced by the PostgreSQL-engine tables. */
  collection: string;
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

/**
 * Creates the named collection holding the PostgreSQL credentials server-side.
 *
 * Credentials live in the collection, never in a table definition and never in
 * a query: the restricted identity is granted neither `NAMED COLLECTION` nor
 * `SHOW NAMED COLLECTIONS`, so `SHOW CREATE TABLE` on a mapped table reveals
 * the collection's *name* and nothing more.
 *
 * Dropped first rather than `IF NOT EXISTS`, so re-provisioning against a host
 * whose address has changed converges instead of silently keeping the old one.
 */
export function postgresNamedCollectionStatements({
  connection,
}: {
  connection: PostgresNamedCollection;
}): string[] {
  assertIdentifier(connection.collection, "named collection");
  if (!Number.isInteger(connection.port)) {
    throw new Error(
      `governed-sql provisioning: named collection port must be an integer, got ${connection.port}`,
    );
  }
  return [
    `DROP NAMED COLLECTION IF EXISTS ${connection.collection}`,
    `CREATE NAMED COLLECTION ${connection.collection} AS ` +
      `host=${clickHouseLiteral(connection.host)}, ` +
      `port=${connection.port}, ` +
      `database=${clickHouseLiteral(connection.database)}, ` +
      `user=${clickHouseLiteral(connection.user)}, ` +
      `password=${clickHouseLiteral(connection.password)}`,
  ];
}

/** A column of a PostgreSQL-engine table, in ClickHouse types. */
export interface GovernedColumn {
  name: string;
  type: string;
}

/**
 * Maps one approved PostgreSQL view into the governed database as a
 * PostgreSQL-engine table.
 *
 * The mapped object is a *view* on the PostgreSQL side, not a base table:
 * column-level exclusions (content-gated fields) are enforced by the view
 * definition and by the PG role's grants, before ClickHouse ever sees a row.
 */
export function postgresEngineTableStatement({
  names,
  table,
  columns,
  collection,
  postgresRelation,
  connectionPoolSize = DEFAULT_POSTGRES_ENGINE_POOL_SIZE,
}: {
  names: GovernedSqlNames;
  table: string;
  columns: GovernedColumn[];
  collection: string;
  postgresRelation: string;
  /** Connections this one mapped table may hold open. See the constant. */
  connectionPoolSize?: number;
}): string {
  assertNames(names);
  assertIdentifier(collection, "named collection");
  assertIdentifier(postgresRelation, "postgresRelation");
  if (columns.length === 0) {
    throw new Error(
      `governed-sql provisioning: PostgreSQL-engine table "${table}" needs at least one column`,
    );
  }
  if (!Number.isInteger(connectionPoolSize) || connectionPoolSize < 1) {
    throw new Error(
      `governed-sql provisioning: connectionPoolSize must be a positive integer, got ${connectionPoolSize}`,
    );
  }
  const columnList = columns
    .map(
      (column) => `${assertIdentifier(column.name, "column")} ${column.type}`,
    )
    .join(", ");
  return (
    `CREATE TABLE IF NOT EXISTS ${qualified(names, table)} (${columnList}) ` +
    `ENGINE = PostgreSQL(${collection}, table=${clickHouseLiteral(postgresRelation)}) ` +
    `SETTINGS postgresql_connection_pool_size = ${connectionPoolSize}`
  );
}

/**
 * Connections one mapped table may hold open against the primary.
 *
 * The demand on the primary is *per mapped table*, not per deployment:
 * ClickHouse builds a connection pool for each PostgreSQL-engine storage, so a
 * catalog of six datasets asks for six pools. At the server default of 16 that
 * is up to 96 connections from the analytics path alone — measured, an
 * unbounded pool grew to 5 connections for a single table under eight
 * concurrent reads, and six tables exhausted a `CONNECTION LIMIT` of 5 with
 * *idle pooled* connections, which then refused the role's next login outright.
 *
 * Two rather than one: one serialises every governed query touching that
 * dataset behind a single connection, and the point is to bound the primary's
 * exposure, not to remove concurrency. Pair it with
 * `governedPostgresReaderConnectionLimit`, which sizes the role's cap above the
 * catalog's total demand so that the cap stays a backstop rather than becoming
 * the thing that fails first.
 */
export const DEFAULT_POSTGRES_ENGINE_POOL_SIZE = 2;

/**
 * The approved PostgreSQL view for one mapped dataset.
 *
 * The boundary the whole PostgreSQL half rests on. The reader role is granted
 * `SELECT` on the views this produces and on nothing else, so a column the
 * catalog does not expose has no path to a governed query — it is unreachable
 * rather than merely unselected, which is the property
 * `postgresReaderRoleStatements` documents and this is the other half of.
 *
 * Column names are the catalog's, not the application's: the view is where
 * `projectId` (and, on `Project`, `id`) becomes `TenantId`, which is what lets
 * one row-policy shape serve every governed object and lets a caller join
 * across residences without knowing which side is which.
 *
 * `CREATE OR REPLACE` rather than `IF NOT EXISTS`, matching the ClickHouse
 * views: re-provisioning after the catalog changed must converge, and a view
 * that silently kept an older column list would keep exposing a column the
 * catalog no longer claims. PostgreSQL refuses to `REPLACE` a view whose
 * existing columns are not a prefix of the new ones, so a removed or retyped
 * column fails loudly at provisioning time instead.
 */
export function postgresApprovedViewStatement({
  schema,
  view,
  baseRelation,
  columns,
}: {
  schema: string;
  /** Name of the view to create. */
  view: string;
  /** Table in the application's schema it reads. */
  baseRelation: string;
  /** Exposed name and the base relation's column behind it, in catalog order. */
  columns: readonly { exposed: string; source: string }[];
}): string {
  const quotedSchema = postgresQuoted(schema);
  const quotedView = postgresQuoted(view);
  if (columns.length === 0) {
    throw new Error(
      `governed-sql provisioning: approved view "${view}" needs at least one column`,
    );
  }
  const projection = columns
    .map(
      (column) =>
        `  ${postgresQuoted(column.source)} AS ${postgresQuoted(column.exposed)}`,
    )
    .join(",\n");
  return (
    `CREATE OR REPLACE VIEW ${quotedSchema}.${quotedView} AS\nSELECT\n${projection}\n` +
    `FROM ${quotedSchema}.${postgresQuoted(baseRelation)}`
  );
}

/** How the dedicated PostgreSQL role is constrained. */
export interface PostgresReaderRole {
  role: string;
  password: string;
  /** Schema the approved views live in. */
  schema: string;
  /** Views — never base tables — the role may read. */
  approvedViews: string[];
  connectionLimit: number;
  /** PostgreSQL interval literal, e.g. `10s`. */
  statementTimeout: string;
}

/**
 * Matches the ClickHouse-side ceilings, so neither layer outlives the other.
 *
 * `connectionLimit` is a *floor for a one-table deployment* and is not the
 * number a real catalog should use: the demand is per mapped table, so the cap
 * has to be derived from how many there are. Use
 * `governedPostgresReaderConnectionLimit` from `../views.ts`, which does that —
 * this constant is what a caller mapping a single table by hand would want.
 */
export const DEFAULT_POSTGRES_READER_LIMITS = {
  connectionLimit: 5,
  statementTimeout: "10s",
} as const;

/**
 * Provisions the dedicated PostgreSQL role the named collection connects as.
 *
 * Three independent limits, none of which relies on ClickHouse behaving:
 * `default_transaction_read_only` makes every statement the role can issue a
 * read (ClickHouse wraps its reads in `BEGIN READ ONLY` regardless, but the
 * role does not depend on that); `statement_timeout` bounds a single query's
 * load on the primary; `CONNECTION LIMIT` bounds how much of the primary's
 * connection budget the analytics path can take.
 *
 * The role is granted `SELECT` on the approved views only. Base tables stay
 * unreadable, so a column dropped from a view is unreachable rather than merely
 * unselected.
 *
 * Idempotent: existence is settled once, then every property is converged with
 * `ALTER`, so re-provisioning an already-configured server is a no-op.
 */
export function postgresReaderRoleStatements({
  reader,
}: {
  reader: PostgresReaderRole;
}): string[] {
  // Quoted, like every other PostgreSQL identifier this module emits — and the
  // existence probe compares `rolname` against the *unquoted* spelling on
  // purpose: `CREATE ROLE "ChReader"` stores `ChReader`, so an unquoted create
  // would store `chreader`, never match the probe, and make every re-run try to
  // create a role that already exists.
  const role = postgresQuoted(reader.role);
  const schema = postgresQuoted(reader.schema);
  if (reader.approvedViews.length === 0) {
    throw new Error(
      `governed-sql provisioning: PostgreSQL role "${reader.role}" needs at least one approved view; ` +
        `a role with no readable relation cannot serve the mapped tables`,
    );
  }
  if (!Number.isInteger(reader.connectionLimit)) {
    throw new Error(
      `governed-sql provisioning: connectionLimit must be an integer, got ${reader.connectionLimit}`,
    );
  }
  return [
    `DO $$\nBEGIN\n` +
      `  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${postgresLiteral(reader.role)}) THEN\n` +
      `    EXECUTE 'CREATE ROLE ${role} LOGIN';\n` +
      `  END IF;\nEND\n$$`,
    `ALTER ROLE ${role} WITH LOGIN PASSWORD ${postgresLiteral(reader.password)} ` +
      `CONNECTION LIMIT ${reader.connectionLimit}`,
    `ALTER ROLE ${role} SET default_transaction_read_only = on`,
    `ALTER ROLE ${role} SET statement_timeout = ${postgresLiteral(reader.statementTimeout)}`,
    `REVOKE ALL ON SCHEMA ${schema} FROM ${role}`,
    `GRANT USAGE ON SCHEMA ${schema} TO ${role}`,
    ...reader.approvedViews.map(
      (view) => `GRANT SELECT ON ${schema}.${postgresQuoted(view)} TO ${role}`,
    ),
  ];
}
