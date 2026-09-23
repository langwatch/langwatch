/**
 * LangWatchQL analytics SQL — the ClickHouse access model.
 *
 * The LangWatchQL API hands customer-written ClickHouse SQL to a single shared
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
 *     else on the LangWatchQL objects.
 *  3. A key-map table mapping an API-key *hash* to the tenant it authorizes.
 *     The raw key never reaches ClickHouse.
 *  4. One row policy per LangWatchQL object, resolving the tenant set through
 *     that key map keyed on the per-query setting — plus a self-policy on the
 *     key map itself, so the reader can only ever see its own rows.
 *
 * The tenant context travels per query as the custom setting named by
 * {@link LangWatchQLNames.tenantSetting}, carrying a comma-joined set of the
 * caller's per-project key hashes (see `../capability.ts`). Because the profile
 * declares it with a default of `''` and no key map row has an empty hash, a
 * caller who sends nothing reads nothing: the model fails closed by
 * construction rather than by a check somewhere in the gateway.
 *
 * Two server-level prerequisites are NOT expressible in SQL and ship as XML —
 * see {@link CLICKHOUSE_CUSTOM_SETTINGS_PREFIX_CONFIG_XML} and
 * {@link clickHouseAccessManagementConfigXml}. Without the first, every
 * statement here fails with UNKNOWN_SETTING (115).
 *
 * Every name emitted below is interpolated into SQL text, so it goes through
 * `../sqlText.ts`: `assertIdentifier` for identifiers and the literal escapers
 * for values.
 *
 * Some LangWatchQL datasets live in PostgreSQL rather than ClickHouse. The access
 * model here applies to them unchanged — the path that maps them in is
 * `./postgresMapping.ts`.
 *
 * @see ./postgresMapping.ts — the PostgreSQL-resident datasets this model covers
 * @see ../sqlText.ts — the escaping and identifier rules these statements obey
 * @see specs/lwql/api.feature
 */

import { assertIdentifier, clickHouseLiteral } from "../sqlText";

// The access-statement builders moved to `./accessModelDdl.ts` (issue #8258),
// where they consume the shared access-model definition alongside the users.d
// YAML emitter. Re-exported here so every existing importer is unchanged; the
// move is byte-identical, proven by `__tests__/accessModelDdl.fixture.unit.test.ts`.
export {
  dropLangWatchQLRowPolicyStatement,
  LWQL_KEY_MAP_SELF_FILTER_TEMPLATE,
  LWQL_TENANT_PREDICATE_TEMPLATE,
  lwqlClickHouseSetupStatements,
  lwqlGrantStatement,
  lwqlKeyMapRowPolicyStatement,
  lwqlRestrictedUserStatement,
  lwqlRowPolicyStatement,
  lwqlSettingsProfileStatement,
} from "./accessModelDdl";

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
 *
 * `show_named_collections_secrets` is deliberately NOT granted, for parity with
 * the chart-managed renderer (`infra/clickhouse-serverless`): the `lwql_postgres`
 * named collection holds a plaintext PostgreSQL password — ClickHouse must dial
 * PG with the real value — and that grant would expose it through
 * `SHOW CREATE NAMED COLLECTION`. `show_named_collections` (existence, secrets
 * redacted) is enough to administer the collection, and nothing here reads the
 * collection back: `./postgresMapping.ts` only ever writes it.
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
  "/etc/clickhouse-server/users.d/zz-lwql-access-management.xml";

/** Column names of the key-map table, which this module owns end to end. */
export const KEY_MAP_COLUMNS = {
  /** Hash of the caller's API key. The raw key is never stored or sent. */
  keyHash: "KeyHash",
  /** Tenant the hash authorizes. */
  tenantId: "TenantId",
} as const;

/** Names of the LangWatchQL objects, so a deployment can rename without a fork. */
export interface LangWatchQLNames {
  /** Database holding every LangWatchQL object. */
  database: string;
  /** The shared restricted identity every LangWatchQL query executes as. */
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

/** A LangWatchQL object and the column its row policy filters on. */
export interface LangWatchQLTable {
  /** Table name within {@link LangWatchQLTable.database}. */
  table: string;
  /** Column holding the owning tenant id. */
  tenantColumn: string;
  /**
   * Database holding the table. Defaults to {@link LangWatchQLNames.database}.
   *
   * The LangWatchQL views are normal `INVOKER` views, so the row policy that
   * bounds them has to sit on the *source* table — which lives in the
   * application's own database, not the LangWatchQL one. Everything created
   * directly in the LangWatchQL database omits this.
   */
  database?: string;
}

/**
 * Validates every configured name, and that the tenant setting carries the
 * declared prefix. Exported for `./postgresMapping.ts`, whose engine tables are
 * created in this same LangWatchQL database and so must clear the same checks.
 */
export function assertNames(names: LangWatchQLNames): LangWatchQLNames {
  assertIdentifier(names.database, "database");
  assertIdentifier(names.restrictedUser, "restrictedUser");
  assertIdentifier(names.settingsProfile, "settingsProfile");
  assertIdentifier(names.keyMapTable, "keyMapTable");
  assertIdentifier(names.tenantSetting, "tenantSetting");
  if (!names.tenantSetting.startsWith("custom_")) {
    throw new Error(
      `lwql provisioning: tenantSetting must start with "custom_" to match the declared ` +
        `custom_settings_prefixes, got "${names.tenantSetting}"`,
    );
  }
  return names;
}

/**
 * `database.table`, both validated. Exported for `./postgresMapping.ts`, which
 * qualifies its engine tables into the same LangWatchQL database.
 */
export function qualified(
  names: LangWatchQLNames,
  table: string,
  database?: string,
): string {
  const owner = database ?? names.database;
  return `${assertIdentifier(owner, "database")}.${assertIdentifier(table, "table")}`;
}

/**
 * The key-map table: `KeyHash` to `TenantId`, one row per project — the hash
 * of `Project.lwqlKey`, not of any credential a caller holds.
 *
 * "One row per project" is the intended shape, not a constraint this table can
 * hold. `ORDER BY KeyHash` is MergeTree's sort key and says nothing about
 * uniqueness, and no code here writes the table. The invariant is therefore
 * enforced where it is read — see {@link tenantPredicate}, which admits a
 * tenant only when the hash resolves to exactly one, so a conflicting map
 * denies access instead of granting it twice over. `ReplacingMergeTree` is not
 * a substitute: without an explicit version column and `FINAL` at read time it
 * only promises eventual dedup, and the policy would read the duplicates in
 * the window before a merge.
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
export function lwqlKeyMapTableStatement({
  names,
  sourceDatabase,
}: {
  names: LangWatchQLNames;
  /**
   * Database the key-map table actually lives in. Defaults to
   * {@link LangWatchQLNames.database} — the test harness's own convention,
   * where the suite provisions its key map alongside everything else. A real
   * deploy passes the app's ClickHouse database here instead, matching
   * migration 00084's table.
   */
  sourceDatabase?: string;
}): string {
  assertNames(names);
  return (
    `CREATE TABLE IF NOT EXISTS ${qualified(names, names.keyMapTable, sourceDatabase)} ` +
    `(${KEY_MAP_COLUMNS.keyHash} String, ${KEY_MAP_COLUMNS.tenantId} String) ` +
    `ENGINE = MergeTree ORDER BY ${KEY_MAP_COLUMNS.keyHash}`
  );
}

/**
 * Audits the LangWatchQL database for views that would void the model.
 *
 * A view declared `SQL SECURITY DEFINER` reads its source tables as its definer,
 * not as the caller, so row policies do not apply to it. Measured against
 * 25.10.2.65: a `DEFINER` view over a policed table returned *both* tenants'
 * rows to the restricted identity. No LangWatchQL view may be `DEFINER`, and a
 * `MATERIALIZED VIEW` defaults to `DEFINER`, so both are reported.
 *
 * Returns rows of `{ name, engine, create_table_query }` for every offending
 * view; an empty result is the healthy state. Run as an administrative user —
 * the restricted identity cannot read `system.tables` beyond its own grants.
 */
export function definerViewAuditQuery({
  names,
}: {
  names: LangWatchQLNames;
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
 * Grants are the definition of "exposed", so adding a LangWatchQL object and
 * granting it without scoping it turns this red with no test edit. Deliberately
 * spans every database rather than only the LangWatchQL one: the LangWatchQL views
 * are `INVOKER` views over the application's own fact tables, so the grants
 * that matter most sit *outside* the LangWatchQL database, and an audit scoped to
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
export function lwqlPolicyCoverageQuery({
  names,
}: {
  names: LangWatchQLNames;
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
 * Audits that the restricted identity holds no function-management grant.
 *
 * The third audit beside {@link lwqlPolicyCoverageQuery} and
 * {@link definerViewAuditQuery}, neither of which looks at functions at all.
 * Calling a SQL UDF needs no grant — measured: the restricted identity's 30
 * grant rows hold nothing matching `%FUNCTION%` and the call still works under
 * `readonly = 1` — so there is never a reason for this identity to hold one,
 * and a grant that appeared here would let customer-written SQL replace the
 * very projection UDFs the hydration stage trusts. Returns rows of
 * `{ access_type }`; empty is the healthy state. Run as an administrative user.
 *
 * @see ./appFunctionStatements.ts — the functions this audit is about
 */
export function lwqlAppFunctionGrantAuditQuery({
  names,
}: {
  names: LangWatchQLNames;
}): string {
  assertNames(names);
  return (
    `SELECT access_type FROM system.grants\n` +
    `WHERE user_name = ${clickHouseLiteral(names.restrictedUser)}\n` +
    `  AND access_type ILIKE '%FUNCTION%'\n` +
    `ORDER BY access_type`
  );
}

/**
 * Audits that no dictionary in the LangWatchQL database serves tenant-scoped data.
 *
 * Dictionaries are not subject to row policies, so any tenant-scoped dictionary
 * reachable by the restricted identity is a bypass — the reason the key map is
 * a self-policed table. See {@link lwqlKeyMapTableStatement}.
 *
 * Returns rows of `{ name }`; an empty result is the healthy state.
 */
export function lwqlDictionaryAuditQuery({
  names,
}: {
  names: LangWatchQLNames;
}): string {
  assertNames(names);
  return (
    `SELECT name FROM system.dictionaries ` +
    `WHERE database = ${clickHouseLiteral(names.database)}`
  );
}
