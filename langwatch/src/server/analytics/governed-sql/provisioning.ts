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
 * {@link CLICKHOUSE_ACCESS_MANAGEMENT_CONFIG_XML}. Without the first, every
 * statement here fails with UNKNOWN_SETTING (115).
 *
 * @see specs/analytics/governed-sql-api.feature
 */

/**
 * Identifier shape both ClickHouse and PostgreSQL accept unquoted.
 *
 * Every name in this module is interpolated into SQL text: neither database
 * binds identifiers as parameters, and a row policy's `USING` expression is
 * text by definition. Names come from deployment configuration rather than from
 * a request, so the check is a programming-error guard, not a customer-facing
 * one — hence a plain `Error`.
 */
const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function assertIdentifier(value: string, role: string): string {
  if (!SAFE_IDENTIFIER.test(value)) {
    throw new Error(
      `governed-sql provisioning: ${role} must match ${String(SAFE_IDENTIFIER)}, got "${value}"`,
    );
  }
  return value;
}

/** ClickHouse string literal: backslash-escaped, single quotes doubled out. */
function clickHouseLiteral(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

/** PostgreSQL string literal under `standard_conforming_strings`: quote-doubled. */
function postgresLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

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
  /** Table name within {@link GovernedSqlNames.database}. */
  table: string;
  /** Column holding the owning tenant id. */
  tenantColumn: string;
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
function qualified(names: GovernedSqlNames, table: string): string {
  return `${assertIdentifier(names.database, "database")}.${assertIdentifier(table, "table")}`;
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

/** The shared restricted identity, carrying the profile and nothing else. */
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
    `IDENTIFIED WITH plaintext_password BY ${clickHouseLiteral(password)} ` +
    `SETTINGS PROFILE ${names.settingsProfile}`
  );
}

/** `SELECT` on one governed object. The identity is granted nothing else. */
export function governedGrantStatement({
  names,
  table,
}: {
  names: GovernedSqlNames;
  table: string;
}): string {
  assertNames(names);
  return `GRANT SELECT ON ${qualified(names, table)} TO ${names.restrictedUser}`;
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
    `ON ${qualified(names, governedTable.table)}\n` +
    `  USING ${tenantPredicate({ names, tenantColumn: governedTable.tenantColumn })}\n` +
    `  TO ${names.restrictedUser}`
  );
}

/** Drops one governed object's row policy. Used to prove the policy is load-bearing. */
export function dropGovernedRowPolicyStatement({
  names,
  table,
}: {
  names: GovernedSqlNames;
  table: string;
}): string {
  assertNames(names);
  return `DROP ROW POLICY IF EXISTS ${policyName(table)} ON ${qualified(names, table)}`;
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
 * list: every object the restricted identity holds a `SELECT` grant on must
 * also carry a row policy that applies to it.
 *
 * Grants are the definition of "exposed", so adding a governed object and
 * granting it without writing its policy turns this red with no test edit.
 *
 * Intersected with `system.tables` on purpose: measured against 25.10.2.65, a
 * `SELECT` grant OUTLIVES the `DROP TABLE` of its object, so grants alone would
 * report long-dead objects as uncovered exposure. An object that no longer
 * exists exposes nothing.
 *
 * Returns rows of `{ table, has_policy }`, `has_policy` being ClickHouse's
 * UInt8 0/1. Run as an administrative user.
 */
export function governedPolicyCoverageQuery({
  names,
}: {
  names: GovernedSqlNames;
}): string {
  assertNames(names);
  const user = clickHouseLiteral(names.restrictedUser);
  const database = clickHouseLiteral(names.database);
  return (
    `SELECT\n` +
    `  t.name AS table,\n` +
    `  t.name IN (\n` +
    `    SELECT table FROM system.row_policies\n` +
    `    WHERE database = ${database} AND has(apply_to_list, ${user})\n` +
    `  ) AS has_policy\n` +
    `FROM system.tables AS t\n` +
    `WHERE t.database = ${database}\n` +
    `  AND t.name IN (\n` +
    `    SELECT table FROM system.grants\n` +
    `    WHERE user_name = ${user}\n` +
    `      AND database = ${database}\n` +
    `      AND access_type = 'SELECT'\n` +
    `      AND table IS NOT NULL\n` +
    `  )\n` +
    `ORDER BY table`
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
}: {
  names: GovernedSqlNames;
  table: string;
  columns: GovernedColumn[];
  collection: string;
  postgresRelation: string;
}): string {
  assertNames(names);
  assertIdentifier(collection, "named collection");
  assertIdentifier(postgresRelation, "postgresRelation");
  if (columns.length === 0) {
    throw new Error(
      `governed-sql provisioning: PostgreSQL-engine table "${table}" needs at least one column`,
    );
  }
  const columnList = columns
    .map((column) => `${assertIdentifier(column.name, "column")} ${column.type}`)
    .join(", ");
  return (
    `CREATE TABLE IF NOT EXISTS ${qualified(names, table)} (${columnList}) ` +
    `ENGINE = PostgreSQL(${collection}, table=${clickHouseLiteral(postgresRelation)})`
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

/** Matches the ClickHouse-side ceilings, so neither layer outlives the other. */
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
  assertIdentifier(reader.role, "PostgreSQL role");
  assertIdentifier(reader.schema, "PostgreSQL schema");
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
      `    EXECUTE 'CREATE ROLE ${reader.role} LOGIN';\n` +
      `  END IF;\nEND\n$$`,
    `ALTER ROLE ${reader.role} WITH LOGIN PASSWORD ${postgresLiteral(reader.password)} ` +
      `CONNECTION LIMIT ${reader.connectionLimit}`,
    `ALTER ROLE ${reader.role} SET default_transaction_read_only = on`,
    `ALTER ROLE ${reader.role} SET statement_timeout = ${postgresLiteral(reader.statementTimeout)}`,
    `REVOKE ALL ON SCHEMA ${reader.schema} FROM ${reader.role}`,
    `GRANT USAGE ON SCHEMA ${reader.schema} TO ${reader.role}`,
    ...reader.approvedViews.map(
      (view) =>
        `GRANT SELECT ON ${reader.schema}.${assertIdentifier(view, "approved view")} TO ${reader.role}`,
    ),
  ];
}
