/**
 * @see ./postgres-mapping.ts — the PostgreSQL-resident datasets this model covers
 * @see ./sql-text.ts — the escaping and identifier rules these statements obey
 * @see specs/analytics/lwql-api.feature
 */

import { clickHouseLiteral } from "../rules/langwatch-ql-sql-literal.rules";
import { LangWatchQLSqlTextService } from "../services/langwatch-ql-sql-text.service";

const sqlText = LangWatchQLSqlTextService.create();

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
   * Database holding the table. Defaults to {@link LangWatchQLNames.database}. The LangWatchQL
   * views are normal `INVOKER` views, so the row policy that bounds them has to sit on the
   * *source* table — which lives in the application's own database, not the LangWatchQL one.
   */
  database?: string;
}

/**
 * Ceilings pinned `CONST` by the profile. Belt and braces rather than the load-bearing control:
 * `readonly = 1` already rejects *every* setting change except the tenant capability, including
 * settings the profile never mentions.
 */
export interface LangWatchQLResourceLimits {
  maxExecutionTimeSeconds: number;
  maxMemoryUsageBytes: number;
  /** Per-query thread ceiling, so one LangWatchQL query cannot saturate the server's cores. */
  maxThreads: number;
  /**
   * How many LangWatchQL queries the shared restricted identity may run at once. The only
   * ceiling here that is not per-query, and the reason it exists: every other bound in this
   * interface constrains a single statement and says nothing about N of them arriving together.
   */
  maxConcurrentQueriesForUser: number;
  /**
   * Scan ceilings, enforced with `read_overflow_mode = 'throw'`: a query that would read past
   * either bound fails instead of silently returning a partial result — partial data that looks
   * complete is the worse failure for an analytics caller.
   */
  maxRowsToRead: number;
  maxBytesToRead: number;
}

/**
 * The shipped ceilings. `maxExecutionTimeSeconds` and `maxMemoryUsageBytes` were measured
 * working against `clickhouse/clickhouse-server:25.10.2.65`.
 */
export const DEFAULT_LWQL_RESOURCE_LIMITS: LangWatchQLResourceLimits = {
  maxExecutionTimeSeconds: 10,
  maxMemoryUsageBytes: 1_000_000_000,
  maxThreads: 4,
  maxConcurrentQueriesForUser: 10,
  maxRowsToRead: 1_000_000_000,
  maxBytesToRead: 10_000_000_000,
};

/**
 * The `USING` expression every LangWatchQL row policy shares: the row's tenant must be the one
 * — and only the one — this request's key hash maps to.
 */
/** `database.table`, with the LangWatchQL database filled in when none is named. */
function qualifiedName(names: LangWatchQLNames, table: string, database?: string): string {
  return `${sqlText.assertIdentifier(database ?? names.database, "database")}.${sqlText.assertIdentifier(table, "table")}`;
}

function tenantPredicate({
  names,
  tenantColumn,
}: {
  names: LangWatchQLNames;
  tenantColumn: string;
}): string {
  return (
    `${sqlText.assertIdentifier(tenantColumn, "tenantColumn")} IN (` +
    `SELECT any(${KEY_MAP_COLUMNS.tenantId}) FROM ${qualifiedName(names, names.keyMapTable)} ` +
    `WHERE ${KEY_MAP_COLUMNS.keyHash} = getSetting(${clickHouseLiteral(names.tenantSetting)}) ` +
    `HAVING uniqExact(${KEY_MAP_COLUMNS.tenantId}) = 1)`
  );
}

/** Policy name for a LangWatchQL object, derived so it is stable across runs. */
function policyName(table: string): string {
  return `${sqlText.assertIdentifier(table, "table")}_tenant`;
}

/** Policy name of the key map's self-policy. */
function keyMapPolicyName(keyMapTable: string): string {
  return `${sqlText.assertIdentifier(keyMapTable, "keyMapTable")}_self`;
}

/** The ClickHouse access model LangWatchQL runs behind, as the statements that create it. */
export class LangWatchQLAccessModelService {
  static create(): LangWatchQLAccessModelService {
    return new LangWatchQLAccessModelService();
  }

  private constructor() {}

  /**
   * Validates every configured name, and that the tenant setting carries the
   * declared prefix. Exported for `./postgres-mapping.ts`, whose engine tables are
   * created in this same LangWatchQL database and so must clear the same checks.
   */
  assertNames(names: LangWatchQLNames): LangWatchQLNames {
    sqlText.assertIdentifier(names.database, "database");
    sqlText.assertIdentifier(names.restrictedUser, "restrictedUser");
    sqlText.assertIdentifier(names.settingsProfile, "settingsProfile");
    sqlText.assertIdentifier(names.keyMapTable, "keyMapTable");
    sqlText.assertIdentifier(names.tenantSetting, "tenantSetting");
    if (!names.tenantSetting.startsWith("custom_")) {
      throw new Error(
        `lwql provisioning: tenantSetting must start with "custom_" to match the declared ` +
          `custom_settings_prefixes, got "${names.tenantSetting}"`,
      );
    }

    return names;
  }

  /**
   * `database.table`, both validated. Exported for `./postgres-mapping.ts`, which
   * qualifies its engine tables into the same LangWatchQL database.
   */
  qualified(names: LangWatchQLNames, table: string, database?: string): string {
    return qualifiedName(names, table, database);
  }

  /**
   * The key-map table: `KeyHash` to `TenantId`, one row per project — the hash of
   * `Project.lwqlKey`, not of any credential a caller holds. "One row per project" is the
   * intended shape, not a constraint this table can hold.
   */
  keyMapTableStatement({ names }: { names: LangWatchQLNames }): string {
    this.assertNames(names);

    return (
      `CREATE TABLE IF NOT EXISTS ${this.qualified(names, names.keyMapTable)} ` +
      `(${KEY_MAP_COLUMNS.keyHash} String, ${KEY_MAP_COLUMNS.tenantId} String) ` +
      `ENGINE = MergeTree ORDER BY ${KEY_MAP_COLUMNS.keyHash}`
    );
  }

  /**
   * The settings profile. The tenant capability is the single `CHANGEABLE_IN_READONLY` setting,
   * and its default of `''` is what makes an absent context read zero rows instead of all rows.
   * Everything else is `CONST`.
   */
  settingsProfileStatement({
    names,
    limits = DEFAULT_LWQL_RESOURCE_LIMITS,
  }: {
    names: LangWatchQLNames;
    limits?: LangWatchQLResourceLimits;
  }): string {
    this.assertNames(names);

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
   */
  restrictedUserStatement({
    names,
    password,
  }: {
    names: LangWatchQLNames;
    password: string;
  }): string {
    this.assertNames(names);

    return (
      `CREATE USER OR REPLACE ${names.restrictedUser} ` +
      `IDENTIFIED WITH sha256_password BY ${clickHouseLiteral(password)} ` +
      `SETTINGS PROFILE ${names.settingsProfile}`
    );
  }

  /**
   * `SELECT` on one LangWatchQL object, every column. The identity is granted nothing else.
   */
  grantStatement({
    names,
    table,
    database,
  }: {
    names: LangWatchQLNames;
    table: string;
    /** Defaults to {@link LangWatchQLNames.database}. */
    database?: string;
  }): string {
    this.assertNames(names);

    return `GRANT SELECT ON ${this.qualified(names, table, database)} TO ${names.restrictedUser}`;
  }

  /**
   * The key map polices itself: the restricted identity sees exactly the row its
   * own hash matches, so it can neither enumerate other tenants' hashes nor
   * confirm a guessed one.
   */
  keyMapRowPolicyStatement({ names }: { names: LangWatchQLNames }): string {
    this.assertNames(names);

    return (
      `CREATE ROW POLICY OR REPLACE ${keyMapPolicyName(names.keyMapTable)} ` +
      `ON ${this.qualified(names, names.keyMapTable)}\n` +
      `  USING ${KEY_MAP_COLUMNS.keyHash} = getSetting(${clickHouseLiteral(names.tenantSetting)})\n` +
      `  TO ${names.restrictedUser}`
    );
  }

  /**
   * One row policy per LangWatchQL object. ClickHouse applies row policies before any user
   * predicate and inside every query shape — CTE, `UNION ALL`, both join sides, subqueries, and
   * `merge()` — so the policy, not the submitted SQL, is what bounds the read.
   */
  rowPolicyStatement({
    names,
    lwqlTable,
  }: {
    names: LangWatchQLNames;
    lwqlTable: LangWatchQLTable;
  }): string {
    this.assertNames(names);

    return (
      `CREATE ROW POLICY OR REPLACE ${policyName(lwqlTable.table)} ` +
      `ON ${this.qualified(names, lwqlTable.table, lwqlTable.database)}\n` +
      `  USING ${tenantPredicate({ names, tenantColumn: lwqlTable.tenantColumn })}\n` +
      `  TO ${names.restrictedUser}`
    );
  }

  /** Drops one LangWatchQL object's row policy. Used to prove the policy is load-bearing. */
  dropRowPolicyStatement({
    names,
    table,
    database,
  }: {
    names: LangWatchQLNames;
    table: string;
    /** Defaults to {@link LangWatchQLNames.database}. */
    database?: string;
  }): string {
    this.assertNames(names);

    return `DROP ROW POLICY IF EXISTS ${policyName(table)} ON ${this.qualified(names, table, database)}`;
  }

  /**
   * Every statement that provisions the LangWatchQL access model, in dependency order. Order is
   * load-bearing, not cosmetic: `CREATE USER OR REPLACE` mints a new access-entity id, so any
   * grant or policy created before it would still point at the replaced user.
   */
  setupStatements({
    names,
    password,
    lwqlTables,
    limits = DEFAULT_LWQL_RESOURCE_LIMITS,
  }: {
    names: LangWatchQLNames;
    password: string;
    lwqlTables: LangWatchQLTable[];
    limits?: LangWatchQLResourceLimits;
  }): string[] {
    this.assertNames(names);

    return [
      `CREATE DATABASE IF NOT EXISTS ${names.database}`,
      this.keyMapTableStatement({ names }),
      this.settingsProfileStatement({ names, limits }),
      this.restrictedUserStatement({ names, password }),
      this.grantStatement({ names, table: names.keyMapTable }),
      ...lwqlTables.map((lwqlTable) => this.grantStatement({ names, table: lwqlTable.table })),
      this.keyMapRowPolicyStatement({ names }),
      ...lwqlTables.map((lwqlTable) => this.rowPolicyStatement({ names, lwqlTable })),
    ];
  }
}
