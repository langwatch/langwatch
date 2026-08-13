/**
 * Governed analytics SQL — the ClickHouse access model.
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
 * `./sqlText.ts`: `assertIdentifier` for identifiers and the literal escapers
 * for values.
 *
 * Some governed datasets live in PostgreSQL rather than ClickHouse. The access
 * model here applies to them unchanged — the path that maps them in is
 * `./postgresMapping.ts`.
 *
 * @see ./postgresMapping.ts — the PostgreSQL-resident datasets this model covers
 * @see ./sqlText.ts — the escaping and identifier rules these statements obey
 * @see specs/analytics/governed-sql-api.feature
 */

import { assertIdentifier, clickHouseLiteral } from "./sqlText";

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
  /** Per-query thread ceiling, so one governed query cannot saturate the server's cores. */
  maxThreads: number;
  /**
   * How many governed queries the shared restricted identity may run at once.
   *
   * The only ceiling here that is not per-query, and the reason it exists: every
   * other bound in this interface constrains a single statement and says nothing
   * about N of them arriving together. Because one identity is shared by every
   * governed query, this is an aggregate bound on the whole API's load — the
   * N+1th concurrent query is refused rather than admitted alongside the others.
   */
  maxConcurrentQueriesForUser: number;
  /**
   * Scan ceilings, enforced with `read_overflow_mode = 'throw'`: a query that
   * would read past either bound fails instead of silently returning a partial
   * result — partial data that looks complete is the worse failure for an
   * analytics caller. The breach reaches the caller as a coded
   * `query_scan_limit_exceeded`, mapped from TOO_MANY_ROWS (158) /
   * TOO_MANY_BYTES (307) by
   * `~/server/app-layer/clients/clickhouse/translate-query-error`.
   */
  maxRowsToRead: number;
  maxBytesToRead: number;
}

/**
 * The shipped ceilings.
 *
 * `maxExecutionTimeSeconds` and `maxMemoryUsageBytes` were measured working
 * against `clickhouse/clickhouse-server:25.10.2.65`. The rest — the thread,
 * scan and concurrency ceilings — are conservative order-of-magnitude choices
 * rather than measurements: nothing has profiled where they should sit, and
 * they are set where a runaway query is refused without a realistic analytical
 * one noticing. That every one of them is *accepted* by that server version is
 * proven, by the integration suites provisioning this profile into a container.
 */
export const DEFAULT_GOVERNED_RESOURCE_LIMITS: GovernedResourceLimits = {
  maxExecutionTimeSeconds: 10,
  maxMemoryUsageBytes: 1_000_000_000,
  maxThreads: 4,
  maxConcurrentQueriesForUser: 10,
  maxRowsToRead: 1_000_000_000,
  maxBytesToRead: 10_000_000_000,
};

/**
 * Validates every configured name, and that the tenant setting carries the
 * declared prefix. Exported for `./postgresMapping.ts`, whose engine tables are
 * created in this same governed database and so must clear the same checks.
 */
export function assertNames(names: GovernedSqlNames): GovernedSqlNames {
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

/**
 * `database.table`, both validated. Exported for `./postgresMapping.ts`, which
 * qualifies its engine tables into the same governed database.
 */
export function qualified(
  names: GovernedSqlNames,
  table: string,
  database?: string,
): string {
  const owner = database ?? names.database;
  return `${assertIdentifier(owner, "database")}.${assertIdentifier(table, "table")}`;
}

/**
 * The key-map table: `KeyHash` to `TenantId`, one row per project — the hash
 * of `Project.governedSqlKey`, not of any credential a caller holds.
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
    `           max_memory_usage = ${limits.maxMemoryUsageBytes} CONST,\n` +
    `           max_threads = ${limits.maxThreads} CONST,\n` +
    `           max_concurrent_queries_for_user = ${limits.maxConcurrentQueriesForUser} CONST,\n` +
    `           max_rows_to_read = ${limits.maxRowsToRead} CONST,\n` +
    `           max_bytes_to_read = ${limits.maxBytesToRead} CONST,\n` +
    `           read_overflow_mode = 'throw' CONST`
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
