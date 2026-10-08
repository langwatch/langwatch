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
 * This module is the SQL half. The access model itself is single-sourced from
 * the definition: {@link renderLwqlAccessModelDdl} renders the settings profile,
 * the restricted user, every row policy and every grant, and
 * {@link renderLwqlNamedCollectionDdl} the config.d named collection — the only
 * access DDL in the codebase (issue #8258). The per-statement builders were
 * deleted; every harness and integration suite now renders from the definition
 * too, so the DDL they provision is byte-identical to production's, pinned by
 * `__tests__/accessModelDdl.fixture.unit.test.ts`.
 *
 * The module also carries {@link lwqlClickHouseSetupStatements} (the structural
 * database / app-function / key-map objects the model sits on) and
 * {@link dropLangWatchQLRowPolicyStatement} (used only to prove the row policy
 * is load-bearing). `accessModel.ts` re-exports those so their importers are
 * unchanged.
 *
 * AC5 logging rule: nothing here logs. It only returns SQL text. A caller that
 * logs a failure must name the statement kind and the ClickHouse error code
 * only — never the text these functions return.
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
 * The restricted profile's settings, in DDL order — the single source both this
 * emitter and the users.d YAML emitter render from.
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
export function lwqlProfileSettings({
  names,
  limits = DEFAULT_LWQL_RESOURCE_LIMITS,
}: {
  names: LangWatchQLNames;
  limits?: LangWatchQLResourceLimits;
}): LwqlProfileSetting[] {
  return [
    {
      name: names.tenantSetting,
      value: "",
      quoted: true,
      constraint: "changeable_in_readonly",
    },
    { name: "readonly", value: 1, constraint: "const" },
    {
      name: "max_execution_time",
      value: limits.maxExecutionTimeSeconds,
      constraint: "const",
    },
    {
      name: "max_memory_usage",
      value: limits.maxMemoryUsageBytes,
      constraint: "const",
    },
    { name: "max_threads", value: limits.maxThreads, constraint: "const" },
    {
      name: "max_concurrent_queries_for_user",
      value: limits.maxConcurrentQueriesForUser,
      constraint: "const",
    },
    {
      name: "max_rows_to_read",
      value: limits.maxRowsToRead,
      constraint: "const",
    },
    {
      name: "max_bytes_to_read",
      value: limits.maxBytesToRead,
      constraint: "const",
    },
    {
      name: "read_overflow_mode",
      value: "throw",
      quoted: true,
      constraint: "const",
    },
    {
      name: "max_result_rows",
      value: limits.maxResultRows,
      constraint: "const",
    },
    {
      name: "max_result_bytes",
      value: limits.maxResultBytes,
      constraint: "const",
    },
    {
      name: "result_overflow_mode",
      value: "throw",
      quoted: true,
      constraint: "const",
    },
  ];
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
 * The structural objects the LangWatchQL access model sits on: the database, the
 * app-function UDFs, and the key-map table. Never the access model itself.
 *
 * The access model — the settings profile, the restricted user, every grant and
 * row policy — is single-sourced from the definition ({@link buildLwqlAccessModelDefinition})
 * and rendered by {@link renderLwqlAccessModelDdl} in `sql` mode, or shipped as
 * per-pod `users.d` config in `rendered` mode. This function never emits it, so
 * there is exactly one code path for access DDL (issue #8258).
 *
 * The LangWatchQL objects the model governs (fact tables, PostgreSQL-engine
 * tables, views) are NOT created here either — they come from migrations, the PG
 * mapping and {@link lwqlViewSetupStatements}. This provisions only the three
 * structural objects the rest depends on.
 */
export function lwqlClickHouseSetupStatements({
  names,
  sourceDatabase,
  includeAppFunctions = true,
}: {
  names: LangWatchQLNames;
  /**
   * Whether the app functions' UDFs are created. Off only where a create
   * would land on one replica of several; see `canProvisionAppFunctions` in
   * `./selfProvisioning.ts`.
   */
  includeAppFunctions?: boolean;
  /**
   * Database the key-map table actually lives in. Defaults to
   * {@link LangWatchQLNames.database}, matching the test harness's convention
   * of provisioning its own key map alongside the rest of the suite. A real
   * deploy must pass the app's ClickHouse database here — migration 00084
   * creates the key-map table there, not in `names.database`, and every
   * statement that reads or writes the key map has to agree on which database
   * that is, or the policies resolve against an empty table and every governed
   * query returns zero rows.
   */
  sourceDatabase?: string;
}): string[] {
  assertNames(names);
  return [
    `CREATE DATABASE IF NOT EXISTS ${names.database}`,
    // The app functions' projection UDFs. They depend on nothing, and calling a
    // SQL UDF needs no grant. See `./appFunctionStatements.ts` for why they are
    // SQL rather than config.
    ...(includeAppFunctions ? lwqlAppFunctionStatements() : []),
    lwqlKeyMapTableStatement({ names, sourceDatabase }),
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

/** The settings profile, rendered from the profile slice of the definition. */
function renderProfileDdl(
  profile: LwqlAccessModelDefinition["profile"],
): string {
  const body = profile.settings
    .map(
      (setting) =>
        `${setting.name} = ${settingValueLiteral(setting)} ${settingConstraintKeyword(setting)}`,
    )
    .join(",\n           ");
  return `CREATE SETTINGS PROFILE OR REPLACE ${profile.name}\n  SETTINGS ${body}`;
}

/**
 * The restricted user, rendered from the user slice of the definition.
 * `sha256_hash BY '<hex>'` rather than `sha256_password BY '<plaintext>'`: the
 * definition never carries the plaintext (AC5), and ClickHouse stores the
 * identical digest either way, so the rendered user and the DDL user
 * authenticate the same password.
 */
function renderUserDdl(
  user: LwqlAccessModelDefinition["user"],
  profileName: string,
): string {
  return (
    `CREATE USER OR REPLACE ${user.name} ` +
    `IDENTIFIED WITH sha256_hash BY '${user.passwordSha256Hex}' ` +
    `SETTINGS PROFILE ${profileName}`
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
 * Renders the access model — the `users.d` half — from the shared definition as
 * ClickHouse DDL: the settings profile, the restricted user, every row policy,
 * then every grant. This is the one source production runs in `sql` mode (see
 * {@link ../selfProvisioning.ts selfHostedClickHouseProvisioningStatements}), and
 * the DDL side of the AC6 parity test against the users.d YAML emitter.
 *
 * Order is load-bearing. `CREATE USER OR REPLACE` mints a new access-entity id,
 * so the user precedes every grant and policy that names it. Every row policy
 * precedes every grant: this list executes statement by statement, and a table
 * granted before it is policed returns every row, so policy-first makes a
 * partial run refuse rather than leak across tenants. Every object the grants
 * and policies name (the key map, the fact tables, the postgres-engine tables,
 * the views) already exists by the time this block runs — the composition places
 * it after the structural DDL.
 *
 * The named collection is emitted separately ({@link renderLwqlNamedCollectionDdl}):
 * it is the one access statement the postgres-engine tables depend on, so it must
 * precede them, whereas this block follows them.
 */
export function renderLwqlAccessModelDdl(
  definition: LwqlAccessModelDefinition,
): string[] {
  const user = definition.user.name;
  return [
    renderProfileDdl(definition.profile),
    renderUserDdl(definition.user, definition.profile.name),
    ...definition.rowPolicies.map((policy) => renderRowPolicyDdl(policy, user)),
    ...definition.grants.map((grant) => renderGrantDdl(grant, user)),
  ];
}

/**
 * Renders the PostgreSQL named collection — the `config.d` half — from the
 * shared definition. Separate from {@link renderLwqlAccessModelDdl} because the
 * postgres-engine tables reference the collection, so the composition emits this
 * before them while the rest of the access model follows them.
 *
 * The credentials live in the collection, never in a table definition and never
 * in a query: the restricted identity is granted neither `NAMED COLLECTION` nor
 * `SHOW NAMED COLLECTIONS`, so `SHOW CREATE TABLE` on a mapped table reveals the
 * collection's *name* and nothing more. Dropped first rather than
 * `IF NOT EXISTS`, so re-provisioning against a host whose address changed
 * converges instead of silently keeping the old one.
 */
export function renderLwqlNamedCollectionDdl(
  definition: LwqlAccessModelDefinition,
): string[] {
  const { namedCollection } = definition;
  assertIdentifier(namedCollection.collection, "named collection");
  if (!Number.isInteger(namedCollection.port)) {
    throw new Error(
      `lwql provisioning: named collection port must be an integer, got ${namedCollection.port}`,
    );
  }
  return [
    `DROP NAMED COLLECTION IF EXISTS ${namedCollection.collection}`,
    `CREATE NAMED COLLECTION ${namedCollection.collection} AS ` +
      `host=${clickHouseLiteral(namedCollection.host)}, ` +
      `port=${namedCollection.port}, ` +
      `database=${clickHouseLiteral(namedCollection.database)}, ` +
      `user=${clickHouseLiteral(namedCollection.user)}, ` +
      `password=${clickHouseLiteral(namedCollection.password)}`,
  ];
}
