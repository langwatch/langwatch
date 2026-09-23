/**
 * LangWatchQL access model — the SQL DDL emitter.
 *
 * `accessModel.ts` used to hold both the access-model *statement builders* and
 * the things that are not access model (the key-map table DDL, the audit
 * queries, the two server-level XML configs). Issue #8258 splits the model into
 * one typed, side-effect-free definition ({@link ./accessModelDefinition.ts})
 * and two emitters over it — this SQL one and the `users.d` YAML one
 * ({@link ./accessModelUsersConfig.ts}) — so the BYO DDL path and the
 * chart/SaaS rendered path can never drift.
 *
 * This module is the SQL half. It carries the individual statement builders,
 * relocated here verbatim from `accessModel.ts` (a byte-identical move, proven
 * by `__tests__/accessModelDdl.fixture.unit.test.ts`), and
 * {@link renderLwqlAccessModelDdl}, which renders the whole model straight from
 * the definition so the parity test can compare it structurally against the
 * YAML.
 *
 * `accessModel.ts` re-exports the builders below so every existing importer is
 * unchanged.
 *
 * AC5 logging rule: nothing here logs. It only returns SQL text. A caller that
 * logs a failure must name the statement kind and the ClickHouse error code
 * only — never the text these builders return.
 *
 * @see ./accessModelDefinition.ts — the typed definition both emitters consume
 * @see ./accessModelUsersConfig.ts — the users.d / config.d YAML emitter
 * @see ./accessModel.ts — the non-access-model remainder and the re-exports
 * @see specs/lwql/access-model.feature
 */

import {
  DEFAULT_LWQL_RESOURCE_LIMITS,
  type LangWatchQLResourceLimits,
} from "../limits";
import { assertIdentifier, clickHouseLiteral } from "../sqlText";
import {
  assertNames,
  KEY_MAP_COLUMNS,
  type LangWatchQLNames,
  type LangWatchQLTable,
  lwqlKeyMapTableStatement,
  qualified,
} from "./accessModel";
import type {
  LwqlAccessModelDefinition,
  LwqlGrantTarget,
  LwqlProfileSetting,
  LwqlRowPolicyTarget,
} from "./accessModelDefinition";
import { lwqlAppFunctionStatements } from "./appFunctionStatements";
import { postgresNamedCollectionStatements } from "./postgresMapping";

/**
 * The tenant predicate. This constant is the single source: the app owns the
 * row policy on every distribution (issue #8258), so there is one definition of
 * the predicate and nothing to keep in parity with a rendered copy.
 *
 * The predicate is a *set* membership as of #8085: the tenant capability carries
 * a comma-joined set of per-project key hashes (see {@link lwqlTenantCapabilitySet}
 * in `../capability.ts`), and a row is admitted when its tenant is the one — and
 * only the one — an in-set hash maps to. `splitByChar(',', getSetting(...))` on
 * the empty default yields `['']`, which no 64-hex key hash matches, so an
 * absent or empty capability still reads zero rows.
 */
export const LWQL_TENANT_PREDICATE_TEMPLATE =
  "{tenantColumn} IN (SELECT any({tenantId}) FROM {keyMap} WHERE has(splitByChar(',', getSetting('{tenantSetting}')), {keyHash}) GROUP BY {keyHash} HAVING uniqExact({tenantId}) = 1)";

/**
 * The key map's self-policy expression. Like {@link LWQL_TENANT_PREDICATE_TEMPLATE},
 * this constant is the single source — the app owns the key-map row policy.
 *
 * It has to be set membership too, not a bare equality: ClickHouse applies the
 * key map's own row policy to *every* read of that table, including the subquery
 * inside {@link LWQL_TENANT_PREDICATE_TEMPLATE}. Left as `KeyHash = getSetting(...)`
 * it would compare a hash against the whole comma-joined set string, match no
 * row, and starve the tenant predicate of every tenant — the whole model would
 * return zero rows.
 */
export const LWQL_KEY_MAP_SELF_FILTER_TEMPLATE =
  "has(splitByChar(',', getSetting('{tenantSetting}')), {keyHash})";

/**
 * Substitutes the `{placeholder}` slots of a single-sourced predicate template.
 *
 * Every value here is already a validated identifier or a `database.table`
 * built from validated identifiers, so this only assembles text — it adds no
 * escaping of its own, and must never be handed a caller-supplied value.
 */
export function renderLwqlPredicateTemplate(
  template: string,
  substitutions: Readonly<Record<string, string>>,
): string {
  return Object.entries(substitutions).reduce(
    (rendered, [name, value]) => rendered.split(`{${name}}`).join(value),
    template,
  );
}

/**
 * The `USING` expression every LangWatchQL row policy shares: the row's tenant
 * must be one — and only one — the request's key-hash set maps to.
 *
 * The `HAVING`, now under `GROUP BY {keyHash}`, is still the load-bearing part,
 * and it is here because the key map cannot enforce the invariant itself.
 * `MergeTree ORDER BY KeyHash` sorts by that key, it does not make it unique,
 * and nothing in this application writes the table: the rows arrive out of band.
 * So a hash mapped to two tenants is representable, and a bare `IN` over the
 * matching rows would admit both — one bad row would hand a caller another
 * tenant's data.
 *
 * Grouping by the hash evaluates each in-set hash on its own, so
 * `HAVING uniqExact(...) = 1` fails that hash closed while every other hash in
 * the set still contributes:
 *
 * - no rows        — the hash contributes no group, nothing is admitted for it
 * - one tenant     — admitted, however many duplicate rows carry it
 * - two or more    — that hash's group is dropped, and *neither* tenant is admitted
 *
 * The third case is the point: a conflicting map revokes that hash's access
 * rather than widening it. `any()` is safe under the `HAVING` because it only
 * ever runs on a group already proven to hold exactly one distinct tenant.
 */
export function lwqlTenantPredicate({
  names,
  tenantColumn,
  sourceDatabase,
}: {
  names: LangWatchQLNames;
  tenantColumn: string;
  /** Database the key-map table actually lives in. Defaults to {@link LangWatchQLNames.database}. */
  sourceDatabase?: string;
}): string {
  return renderLwqlPredicateTemplate(LWQL_TENANT_PREDICATE_TEMPLATE, {
    tenantColumn: assertIdentifier(tenantColumn, "tenantColumn"),
    tenantId: KEY_MAP_COLUMNS.tenantId,
    keyHash: KEY_MAP_COLUMNS.keyHash,
    keyMap: qualified(names, names.keyMapTable, sourceDatabase),
    tenantSetting: names.tenantSetting,
  });
}

/** The key map's self-filter expression, single-sourced from the template. */
export function lwqlKeyMapSelfFilter(names: LangWatchQLNames): string {
  return renderLwqlPredicateTemplate(LWQL_KEY_MAP_SELF_FILTER_TEMPLATE, {
    keyHash: KEY_MAP_COLUMNS.keyHash,
    tenantSetting: names.tenantSetting,
  });
}

/** Policy name for a LangWatchQL object, derived so it is stable across runs. */
export function lwqlRowPolicyName(table: string): string {
  return `${assertIdentifier(table, "table")}_tenant`;
}

/** Policy name of the key map's self-policy. */
export function lwqlKeyMapPolicyName(keyMapTable: string): string {
  return `${assertIdentifier(keyMapTable, "keyMapTable")}_self`;
}

/**
 * The settings profile.
 *
 * The tenant capability is the single `CHANGEABLE_IN_READONLY` setting, and its
 * default of `''` is what makes an absent context read zero rows instead of all
 * rows. Everything else is `CONST`.
 *
 * `max_result_rows` / `max_result_bytes` (with `result_overflow_mode =
 * 'throw'`) are the backstop for the row cap the validator and service already
 * enforce in TypeScript — see {@link LangWatchQLResourceLimits.maxResultRows}.
 * A `LIMIT` written as a bound parameter (`LIMIT {n:UInt64}`) is not a value
 * the validator can read, so it passes both the append decision and the
 * `LIMIT_TOO_HIGH` refusal. Pinning the same ceiling `CONST` server-side means
 * such a query still cannot return more than the cap — it fails with
 * TOO_MANY_ROWS_OR_BYTES (396) instead, mapped to `lwql_result_too_large` by
 * `isClickHouseResultTooLargeError` in the executor, never surfaced raw.
 */
export function lwqlSettingsProfileStatement({
  names,
  limits = DEFAULT_LWQL_RESOURCE_LIMITS,
}: {
  names: LangWatchQLNames;
  limits?: LangWatchQLResourceLimits;
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
    `           read_overflow_mode = 'throw' CONST,\n` +
    `           max_result_rows = ${limits.maxResultRows} CONST,\n` +
    `           max_result_bytes = ${limits.maxResultBytes} CONST,\n` +
    `           result_overflow_mode = 'throw' CONST`
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
 * LangWatchQL query, so a recovered password is a foothold on all of them.
 */
export function lwqlRestrictedUserStatement({
  names,
  password,
}: {
  names: LangWatchQLNames;
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
 * `SELECT` on one LangWatchQL object, every column. The identity is granted
 * nothing else.
 *
 * Whole-object rather than column-scoped, because the objects granted this way
 * are the LangWatchQL views themselves and the key map — things whose entire
 * column list is the exposed surface by construction. Source tables are granted
 * column by column instead; see `lwqlSourceColumnGrantStatement`.
 */
export function lwqlGrantStatement({
  names,
  table,
  database,
}: {
  names: LangWatchQLNames;
  table: string;
  /** Defaults to {@link LangWatchQLNames.database}. */
  database?: string;
}): string {
  assertNames(names);
  return `GRANT SELECT ON ${qualified(names, table, database)} TO ${names.restrictedUser}`;
}

/**
 * The key map polices itself: the restricted identity sees exactly the row its
 * own hash matches, so it can neither enumerate other tenants' hashes nor
 * confirm a guessed one.
 */
export function lwqlKeyMapRowPolicyStatement({
  names,
  sourceDatabase,
}: {
  names: LangWatchQLNames;
  /** Database the key-map table actually lives in. Defaults to {@link LangWatchQLNames.database}. */
  sourceDatabase?: string;
}): string {
  assertNames(names);
  return (
    `CREATE ROW POLICY OR REPLACE ${lwqlKeyMapPolicyName(names.keyMapTable)} ` +
    `ON ${qualified(names, names.keyMapTable, sourceDatabase)}\n` +
    `  USING ${lwqlKeyMapSelfFilter(names)}\n` +
    `  TO ${names.restrictedUser}`
  );
}

/**
 * One row policy per LangWatchQL object.
 *
 * ClickHouse applies row policies before any user predicate and inside every
 * query shape — CTE, `UNION ALL`, both join sides, subqueries, and `merge()` —
 * so the policy, not the submitted SQL, is what bounds the read.
 */
export function lwqlRowPolicyStatement({
  names,
  lwqlTable,
  sourceDatabase,
}: {
  names: LangWatchQLNames;
  lwqlTable: LangWatchQLTable;
  /** Database the key-map table actually lives in. Defaults to {@link LangWatchQLNames.database}. */
  sourceDatabase?: string;
}): string {
  assertNames(names);
  return (
    `CREATE ROW POLICY OR REPLACE ${lwqlRowPolicyName(lwqlTable.table)} ` +
    `ON ${qualified(names, lwqlTable.table, lwqlTable.database)}\n` +
    `  USING ${lwqlTenantPredicate({ names, tenantColumn: lwqlTable.tenantColumn, sourceDatabase })}\n` +
    `  TO ${names.restrictedUser}`
  );
}

/** Drops one LangWatchQL object's row policy. Used to prove the policy is load-bearing. */
export function dropLangWatchQLRowPolicyStatement({
  names,
  table,
  database,
}: {
  names: LangWatchQLNames;
  table: string;
  /** Defaults to {@link LangWatchQLNames.database}. */
  database?: string;
}): string {
  assertNames(names);
  return `DROP ROW POLICY IF EXISTS ${lwqlRowPolicyName(table)} ON ${qualified(names, table, database)}`;
}

/**
 * Every statement that provisions the LangWatchQL access model, in dependency
 * order.
 *
 * Order is load-bearing, not cosmetic: `CREATE USER OR REPLACE` mints a new
 * access-entity id, so any grant or policy created before it would still point
 * at the replaced user. Grants and policies must always follow the user.
 *
 * The LangWatchQL objects themselves (fact tables, PostgreSQL-engine tables) are
 * NOT created here — they come from migrations and from the PG mapping. This
 * function provisions only the access model over them.
 *
 * The application provisions this on every distribution (issue #8258): it owns
 * the LangWatchQL access model on both self-hosted and cloud, so there is one
 * definition and no rendered copy to keep in parity.
 *
 * `includeAccessStatements = false` is the `rendered` mode (#8258): the access
 * statements (the profile, the restricted user, the key map's grant and
 * self-policy) are delivered as per-pod `users.d` config instead of DDL, so the
 * converge provisions only the structural objects — the database, the app
 * functions and the key-map table — and skips the access statements. The DDL
 * for the default (`sql` mode, `includeAccessStatements = true`) is unchanged,
 * byte for byte.
 */
export function lwqlClickHouseSetupStatements({
  names,
  password,
  lwqlTables,
  limits = DEFAULT_LWQL_RESOURCE_LIMITS,
  sourceDatabase,
  includeAppFunctions = true,
  includeAccessStatements = true,
}: {
  names: LangWatchQLNames;
  password: string;
  lwqlTables: LangWatchQLTable[];
  limits?: LangWatchQLResourceLimits;
  /**
   * Whether the app functions' UDFs are created. Off only where a create
   * would land on one replica of several; see `canProvisionAppFunctions` in
   * `./selfProvisioning.ts`.
   */
  includeAppFunctions?: boolean;
  /**
   * Whether the access statements (settings profile, restricted user, the key
   * map's grant and self-policy, and every table row policy and grant) are
   * emitted as DDL. `false` is the `rendered` mode: they ship as `users.d`
   * config and the converge provisions only the structural objects. Default
   * `true` keeps the `sql` mode output byte-identical.
   */
  includeAccessStatements?: boolean;
  /**
   * Database the key-map table actually lives in. Defaults to
   * {@link LangWatchQLNames.database}, matching the test harness's convention
   * of provisioning its own key map alongside the rest of the suite. A real
   * deploy must pass the app's ClickHouse database here — migration 00084
   * creates the key-map table there, not in `names.database`, and every
   * statement below that reads or writes the key map (the table itself, its
   * grant, its self-policy, and every LangWatchQL row policy's tenant lookup)
   * has to agree on which database that is, or the policies resolve against
   * an empty table and every governed query returns zero rows.
   */
  sourceDatabase?: string;
}): string[] {
  assertNames(names);
  const accessStatements = includeAccessStatements
    ? [
        lwqlSettingsProfileStatement({ names, limits }),
        lwqlRestrictedUserStatement({ names, password }),
        // Each table's row policy before its grant, and the order is load-bearing.
        // A table carrying a SELECT grant and no row policy returns every row in
        // ClickHouse, so granting first opens a window in which the restricted
        // identity reads across every tenant — and this list is executed statement
        // by statement, not atomically. A caller that dies partway (a dropped
        // connection, one refused statement) leaves that window standing, and
        // `provisionLwql`'s self-provisioning path deliberately swallows the error
        // and continues booting, so nothing downstream would close it.
        //
        // Policy-first inverts the failure: a partial run leaves the identity
        // policed but not yet granted, which refuses reads rather than widening
        // them. Safe because every table named already exists by this point — the
        // key map is created above, and `lwqlTables` are migration-owned.
        lwqlKeyMapRowPolicyStatement({ names, sourceDatabase }),
        ...lwqlTables.map((lwqlTable) =>
          lwqlRowPolicyStatement({ names, lwqlTable, sourceDatabase }),
        ),
        lwqlGrantStatement({
          names,
          table: names.keyMapTable,
          database: sourceDatabase,
        }),
        ...lwqlTables.map((lwqlTable) =>
          lwqlGrantStatement({ names, table: lwqlTable.table }),
        ),
      ]
    : [];
  return [
    `CREATE DATABASE IF NOT EXISTS ${names.database}`,
    // The app functions' projection UDFs. Alongside the other object creation
    // and before the grants: they depend on nothing, and calling a SQL UDF
    // needs no grant, so nothing below refers back to them. See
    // `./appFunctionStatements.ts` for why they are SQL rather than config.
    ...(includeAppFunctions ? lwqlAppFunctionStatements() : []),
    lwqlKeyMapTableStatement({ names, sourceDatabase }),
    ...accessStatements,
  ];
}

// ---------------------------------------------------------------------------
// Definition-driven emitter (AC6): renders the whole access model from the one
// typed definition, so the parity test can compare it structurally against the
// users.d YAML emitter over the same definition.
// ---------------------------------------------------------------------------

/** The `CONST` / `CHANGEABLE_IN_READONLY` keyword for a profile setting. */
function settingConstraintKeyword(setting: LwqlProfileSetting): string {
  return setting.constraint === "changeable_in_readonly"
    ? "CHANGEABLE_IN_READONLY"
    : "CONST";
}

/** A profile setting's value as SQL: quoted string, or a bare number. */
function settingValueLiteral(setting: LwqlProfileSetting): string {
  return setting.quoted ? `'${setting.value}'` : `${setting.value}`;
}

/** The settings profile, rendered from the definition rather than from limits. */
function renderProfileDdl(definition: LwqlAccessModelDefinition): string {
  const body = definition.profile.settings
    .map(
      (setting) =>
        `${setting.name} = ${settingValueLiteral(setting)} ${settingConstraintKeyword(setting)}`,
    )
    .join(",\n           ");
  return `CREATE SETTINGS PROFILE OR REPLACE ${definition.profile.name}\n  SETTINGS ${body}`;
}

/**
 * The restricted user, rendered from the definition. `sha256_hash BY '<hex>'`
 * rather than `sha256_password BY '<plaintext>'`: the definition never carries
 * the plaintext (AC5), and ClickHouse stores the identical digest either way,
 * so the rendered user and the DDL user authenticate the same password.
 */
function renderUserDdl(definition: LwqlAccessModelDefinition): string {
  return (
    `CREATE USER OR REPLACE ${definition.user.name} ` +
    `IDENTIFIED WITH sha256_hash BY '${definition.user.passwordSha256Hex}' ` +
    `SETTINGS PROFILE ${definition.profile.name}`
  );
}

/** One grant, whole-object or column-scoped, rendered from the definition. */
function renderGrantDdl(grant: LwqlGrantTarget, user: string): string {
  const object = `${grant.database}.${grant.table}`;
  const select = grant.columns
    ? `SELECT(${grant.columns.map((column) => `\`${column}\``).join(", ")})`
    : "SELECT";
  return `GRANT ${select} ON ${object} TO ${user}`;
}

/** One row policy, rendered from the definition. */
function renderRowPolicyDdl(policy: LwqlRowPolicyTarget, user: string): string {
  return (
    `CREATE ROW POLICY OR REPLACE ${policy.name} ` +
    `ON ${policy.database}.${policy.table}\n` +
    `  USING ${policy.predicate}\n` +
    `  TO ${user}`
  );
}

/**
 * Renders the whole LangWatchQL access model from the shared definition as
 * ClickHouse DDL: the settings profile, the restricted user, every grant, every
 * row policy and the PostgreSQL named collection. The counterpart of
 * {@link ../accessModelUsersConfig.ts renderLwqlAccessModelUsersConfig}; a
 * parity test proves the two name the identical model.
 */
export function renderLwqlAccessModelDdl(
  definition: LwqlAccessModelDefinition,
): string[] {
  const user = definition.user.name;
  return [
    renderProfileDdl(definition),
    renderUserDdl(definition),
    ...definition.grants.map((grant) => renderGrantDdl(grant, user)),
    ...definition.rowPolicies.map((policy) => renderRowPolicyDdl(policy, user)),
    ...postgresNamedCollectionStatements({
      connection: definition.namedCollection,
    }),
  ];
}
