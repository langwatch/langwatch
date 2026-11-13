/**
 * The one typed access model, LangWatchQL's (ADR-159) and the app reader's (ADR-202), and its two
 * emitters: SQL DDL for a SQL access store, users.d/config.d YAML for a config-store ClickHouse.
 * @see specs/lwql/access-model.feature · specs/clickhouse/app-reader-row-policies.feature
 */

import {
  DEFAULT_LWQL_RESOURCE_LIMITS,
  type LangWatchQLResourceLimits,
} from "@langwatch/analytics-contract/langwatch-ql-limits";

import type { PostgresNamedCollection } from "../features/provisioning/services/langwatch-ql-postgres-mapping.service.ts";
import { LangWatchQLViewProvisioningService } from "../features/provisioning/services/langwatch-ql-view-provisioning.service.ts";
import { LangWatchQLViewStatementsService } from "../features/provisioning/services/langwatch-ql-view-statements.service.ts";
import {
  APP_READER_NAMES,
  APP_READER_SETTINGS_PREFIX,
  APP_READER_TENANT_TABLES,
} from "../rules/app-reader-access.rules.ts";
import { clickHouseLiteral } from "../rules/langwatch-ql-sql-literal.rules.ts";
import { flooredViewNames } from "../rules/lwql-dedup-floor.rules.ts";
import { LWQL_VIEW_CATALOG } from "../rules/lwql-view-catalog.rules.ts";
import {
  LangWatchQLAccessModelService,
  type LangWatchQLNames,
} from "./langwatch-ql-access-model.service.ts";
import {
  LangWatchQLCatalogShapesService,
  type LangWatchQLViewDefinition,
} from "./langwatch-ql-catalog-shapes.service.ts";
import { LangWatchQLSqlTextService } from "./langwatch-ql-sql-text.service.ts";

const accessModel = LangWatchQLAccessModelService.create();
const catalogShapes = LangWatchQLCatalogShapesService.create();
const sqlText = LangWatchQLSqlTextService.create();
const viewProvisioning = LangWatchQLViewProvisioningService.create();
const viewStatements = LangWatchQLViewStatementsService.create();

const LWQL_CUSTOM_SETTINGS_PREFIX = "custom_";
const LWQL_USERS_D_RELATIVE_PATH = "users.d/lwql-access.yaml";
const LWQL_CONFIG_D_RELATIVE_PATH = "config.d/lwql-named-collection.yaml";

const LWQL_USER_NETWORKS_IP = "::/0";

/** One settings-profile entry; `quoted` values are strings, the rest numbers. */
interface LwqlProfileSetting {
  readonly name: string;
  readonly value: string | number;
  readonly quoted?: boolean;
  readonly constraint: "const" | "changeable_in_readonly";
}

/** A SELECT grant; `columns` narrows it to a column list. */
interface LwqlGrantTarget {
  readonly database: string;
  readonly table: string;
  readonly columns?: readonly string[];
}

interface LwqlRowPolicyTarget {
  readonly name: string;
  readonly database: string;
  readonly table: string;
  readonly predicate: string;
}

/** One ClickHouse identity: its user, the profile it carries, its grants and row policies. */
export interface LwqlAccessIdentity {
  readonly user: { readonly name: string; readonly passwordSha256Hex: string };
  readonly profile: { readonly name: string; readonly settings: readonly LwqlProfileSetting[] };
  readonly grants: readonly LwqlGrantTarget[];
  readonly rowPolicies: readonly LwqlRowPolicyTarget[];
}

export interface LwqlAccessModelDefinition extends LwqlAccessIdentity {
  readonly customSettingsPrefix: string;
  readonly namedCollection: PostgresNamedCollection;
  /** Further names config.d delivers with the same connection, for tables bound to them. */
  readonly namedCollectionAliases: readonly string[];
  /** The application's restricted reader (ADR-202), once its credential is supplied. */
  readonly appReader?: LwqlAccessIdentity;
}

export interface RenderedConfigFile {
  readonly relativePath: string;
  readonly contents: string;
}

type YamlValue = string | number | YamlValue[] | { [key: string]: YamlValue };

function yamlString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function writeYaml(value: YamlValue, indent = 0): string {
  const pad = "  ".repeat(indent);
  if (typeof value === "number") return `${value}`;
  if (typeof value === "string") return yamlString(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return value
      .map((item) => `\n${pad}- ${writeYaml(item, indent + 1).replace(/^\s+/, "")}`)
      .join("");
  }
  const entries = Object.entries(value);
  if (entries.length === 0) return "{}";
  return entries
    .map(([key, child]) => {
      const rendered = writeYaml(child, indent + 1);
      const isBlock =
        (typeof child === "object" && !Array.isArray(child) && Object.keys(child).length > 0) ||
        (Array.isArray(child) && child.length > 0);
      return isBlock ? `\n${pad}${key}:${rendered}` : `\n${pad}${key}: ${rendered}`;
    })
    .join("");
}

function yamlDocument(tree: YamlValue): string {
  return `${writeYaml(tree).replace(/^\n/, "")}\n`;
}

/** Config files carry a custom setting as a Field dump, so a string one keeps its quotes. */
function settingYamlValue(setting: LwqlProfileSetting): YamlValue {
  if (!setting.quoted) return Number(setting.value);
  const custom = [LWQL_CUSTOM_SETTINGS_PREFIX, APP_READER_SETTINGS_PREFIX].some((prefix) =>
    setting.name.startsWith(prefix),
  );
  if (custom) return `'${setting.value}'`;
  return setting.value === "" ? "''" : String(setting.value);
}

function selectClause(grant: LwqlGrantTarget): string {
  return grant.columns
    ? `SELECT(${grant.columns.map((column) => `\`${column}\``).join(", ")})`
    : "SELECT";
}

function settingLiteral(setting: LwqlProfileSetting): string {
  return setting.quoted ? `'${setting.value}'` : `${setting.value}`;
}

function settingConstraint(setting: LwqlProfileSetting): string {
  return setting.constraint === "changeable_in_readonly" ? "CHANGEABLE_IN_READONLY" : "CONST";
}

/** Builds the access model once; both emitters read only this, so they cannot disagree. */
export class LangWatchQLAccessModelDefinitionService {
  static create(): LangWatchQLAccessModelDefinitionService {
    return new LangWatchQLAccessModelDefinitionService();
  }

  private constructor() {}

  /**
   * The tenant setting starts empty (zero rows, never all rows), and the query log's comment is
   * the executor's to set; everything else is `CONST`.
   */
  profileSettings({
    names,
    limits = DEFAULT_LWQL_RESOURCE_LIMITS,
  }: {
    names: LangWatchQLNames;
    limits?: LangWatchQLResourceLimits;
  }): LwqlProfileSetting[] {
    const constant = (name: string, value: string | number, quoted = false): LwqlProfileSetting =>
      quoted ? { name, value, quoted, constraint: "const" } : { name, value, constraint: "const" };
    return [
      { name: names.tenantSetting, value: "", quoted: true, constraint: "changeable_in_readonly" },
      { name: "log_comment", value: "", quoted: true, constraint: "changeable_in_readonly" },
      constant("readonly", 1),
      constant("max_execution_time", limits.maxExecutionTimeSeconds),
      constant("max_memory_usage", limits.maxMemoryUsageBytes),
      constant("max_threads", limits.maxThreads),
      constant("max_concurrent_queries_for_user", limits.maxConcurrentQueriesForUser),
      constant("max_rows_to_read", limits.maxRowsToRead),
      constant("max_bytes_to_read", limits.maxBytesToRead),
      constant("read_overflow_mode", "throw", true),
      constant("max_result_rows", limits.maxResultRows),
      constant("max_result_bytes", limits.maxResultBytes),
      constant("result_overflow_mode", "throw", true),
      // Spill to disk instead of failing at max_memory_usage (code 241).
      constant("max_bytes_before_external_group_by", limits.maxBytesBeforeExternalGroupBy),
      constant("max_bytes_before_external_sort", limits.maxBytesBeforeExternalSort),
      constant("join_algorithm", limits.joinAlgorithm, true),
      constant("max_bytes_in_join", limits.maxBytesInJoin),
      // The capability rides in each statement's SETTINGS clause; query_log never keeps it.
      constant("log_query_settings", 0),
      // Opt-in: no server default may turn a cache or introspection on for this identity.
      constant("use_query_cache", 0),
      constant("use_query_condition_cache", 0),
      constant("allow_introspection_functions", 0),
    ];
  }

  /**
   * The app reader's tenant set starts empty and stays the client's to set; the enforce switch
   * and the cache and introspection pins are `CONST` (ADR-200: the condition cache crossed
   * tenants).
   */
  appReaderProfileSettings({ enforce }: { enforce: boolean }): LwqlProfileSetting[] {
    return [
      {
        name: APP_READER_NAMES.tenantSetting,
        value: "",
        quoted: true,
        constraint: "changeable_in_readonly",
      },
      {
        name: APP_READER_NAMES.enforceSetting,
        value: enforce ? "1" : "0",
        quoted: true,
        constraint: "const",
      },
      { name: "use_query_cache", value: 0, constraint: "const" },
      { name: "use_query_condition_cache", value: 0, constraint: "const" },
      { name: "allow_introspection_functions", value: 0, constraint: "const" },
    ];
  }

  build({
    names,
    passwordSha256Hex,
    namedCollection,
    namedCollectionAliases = [],
    sourceDatabase,
    limits = DEFAULT_LWQL_RESOURCE_LIMITS,
    views = LWQL_VIEW_CATALOG,
    appReader,
  }: {
    names: LangWatchQLNames;
    passwordSha256Hex: string;
    namedCollection: PostgresNamedCollection;
    namedCollectionAliases?: readonly string[];
    sourceDatabase: string;
    limits?: LangWatchQLResourceLimits;
    views?: readonly LangWatchQLViewDefinition[];
    /** The app reader's credential hash; `enforce` defaults to shadow (ADR-202 Rollout). */
    appReader?: { passwordSha256Hex: string; enforce?: boolean };
  }): LwqlAccessModelDefinition {
    return {
      customSettingsPrefix: LWQL_CUSTOM_SETTINGS_PREFIX,
      user: { name: names.restrictedUser, passwordSha256Hex },
      profile: { name: names.settingsProfile, settings: this.profileSettings({ names, limits }) },
      grants: this.#grants({ names, sourceDatabase, views }),
      rowPolicies: this.#rowPolicies({ names, sourceDatabase, views }),
      namedCollection,
      namedCollectionAliases,
      ...(appReader ? { appReader: this.#appReader({ ...appReader, sourceDatabase }) } : {}),
    };
  }

  /** Per identity, LangWatchQL's first: profile, user, row policies, then grants. */
  renderDdl(definition: LwqlAccessModelDefinition): string[] {
    return [
      ...this.#identityDdl(definition),
      ...(definition.appReader ? this.#identityDdl(definition.appReader) : []),
    ];
  }

  /** Profile, user, row policies, then grants — the order a SQL access store needs. */
  #identityDdl(identity: LwqlAccessIdentity): string[] {
    const user = identity.user.name;
    const settings = identity.profile.settings
      .map(
        (setting) => `${setting.name} = ${settingLiteral(setting)} ${settingConstraint(setting)}`,
      )
      .join(",\n           ");
    return [
      `CREATE SETTINGS PROFILE OR REPLACE ${identity.profile.name}\n  SETTINGS ${settings}`,
      `CREATE USER OR REPLACE ${user} ` +
        `IDENTIFIED WITH sha256_hash BY '${identity.user.passwordSha256Hex}' ` +
        `SETTINGS PROFILE ${identity.profile.name}`,
      ...identity.rowPolicies.map(
        (policy) =>
          `CREATE ROW POLICY OR REPLACE ${policy.name} ON ${policy.database}.${policy.table}\n` +
          `  USING ${policy.predicate}\n` +
          `  TO ${user}`,
      ),
      ...identity.grants.map(
        (grant) => `GRANT ${selectClause(grant)} ON ${grant.database}.${grant.table} TO ${user}`,
      ),
    ];
  }

  renderNamedCollectionDdl(definition: LwqlAccessModelDefinition): string[] {
    const { namedCollection } = definition;
    sqlText.assertIdentifier(namedCollection.collection, "named collection");
    if (!Number.isInteger(namedCollection.port)) {
      throw new Error(
        `lwql provisioning: named collection port must be an integer, got ${namedCollection.port}`,
      );
    }
    const values =
      `host=${clickHouseLiteral(namedCollection.host)}, ` +
      `port=${namedCollection.port}, ` +
      `database=${clickHouseLiteral(namedCollection.database)}, ` +
      `user=${clickHouseLiteral(namedCollection.user)}, ` +
      `password=${clickHouseLiteral(namedCollection.password)}`;
    // Never DROP: 26.8 refuses it while an engine table uses the collection (769), as ALTER is not.
    return [
      `CREATE NAMED COLLECTION IF NOT EXISTS ${namedCollection.collection} AS ${values}`,
      `ALTER NAMED COLLECTION ${namedCollection.collection} SET ${values}`,
    ];
  }

  /** The users.d and config.d files a config-store ClickHouse merges at boot. */
  renderUsersConfig(definition: LwqlAccessModelDefinition): RenderedConfigFile[] {
    return [
      { relativePath: LWQL_USERS_D_RELATIVE_PATH, contents: this.renderUsersD(definition) },
      {
        relativePath: LWQL_CONFIG_D_RELATIVE_PATH,
        contents: this.renderNamedCollectionConfig(definition),
      },
    ];
  }

  /** One profile and one user per identity, LangWatchQL's first, in a single users.d document. */
  renderUsersD(definition: LwqlAccessModelDefinition): string {
    const profiles: Record<string, YamlValue> = {};
    const users: Record<string, YamlValue> = {};
    for (const identity of [definition, ...(definition.appReader ? [definition.appReader] : [])]) {
      const settings: Record<string, YamlValue> = {};
      const constraints: Record<string, YamlValue> = {};
      for (const setting of identity.profile.settings) {
        settings[setting.name] = settingYamlValue(setting);
        constraints[setting.name] = { [setting.constraint]: "" };
      }
      const databases: Record<string, Record<string, YamlValue>> = {};
      for (const policy of identity.rowPolicies) {
        const tables = (databases[policy.database] ??= {});
        tables[policy.table] = { filter: policy.predicate };
      }
      profiles[identity.profile.name] = { ...settings, constraints };
      users[identity.user.name] = {
        password_sha256_hex: identity.user.passwordSha256Hex,
        networks: { ip: LWQL_USER_NETWORKS_IP },
        profile: identity.profile.name,
        grants: {
          query: identity.grants.map(
            (grant) => `GRANT ${selectClause(grant)} ON ${grant.database}.${grant.table}`,
          ),
        },
        databases,
      };
    }
    return yamlDocument({ profiles, users });
  }

  renderNamedCollectionConfig(definition: LwqlAccessModelDefinition): string {
    const collection = definition.namedCollection;
    const connection = {
      host: collection.host,
      port: collection.port,
      database: collection.database,
      user: collection.user,
      password: collection.password,
    };
    const named: Record<string, YamlValue> = { [collection.collection]: connection };
    for (const alias of definition.namedCollectionAliases) {
      sqlText.assertIdentifier(alias, "named collection");
      named[alias] = connection;
    }
    return yamlDocument({ named_collections: named });
  }

  /** Key map, each source (column-scoped on ClickHouse), each joined side, then each view. */
  #grants({
    names,
    sourceDatabase,
    views,
  }: {
    names: LangWatchQLNames;
    sourceDatabase: string;
    views: readonly LangWatchQLViewDefinition[];
  }): LwqlGrantTarget[] {
    const grants: LwqlGrantTarget[] = [{ database: sourceDatabase, table: names.keyMapTable }];
    for (const view of views) {
      grants.push(
        catalogShapes.isPostgresResident(view)
          ? { database: names.database, table: view.sourceTable }
          : {
              database: sourceDatabase,
              table: view.sourceTable,
              columns: [...viewStatements.grantedSourceColumns(view)],
            },
      );
    }
    for (const view of views) {
      if (!view.join) continue;
      grants.push({
        database: sourceDatabase,
        table: view.join.table,
        columns: [
          ...new Set([...view.join.sourceColumns, ...(view.join.onSourceColumns?.joined ?? [])]),
        ],
      });
    }
    // Before the views, so the views stay the trailing block their catalogue test reads.
    for (const name of flooredViewNames(views)) {
      grants.push({ database: names.database, table: name });
    }
    for (const view of views) {
      grants.push({ database: names.database, table: view.name });
    }
    return grants;
  }

  #rowPolicies({
    names,
    sourceDatabase,
    views,
  }: {
    names: LangWatchQLNames;
    sourceDatabase: string;
    views: readonly LangWatchQLViewDefinition[];
  }): LwqlRowPolicyTarget[] {
    const keyMapPolicy: LwqlRowPolicyTarget = {
      name: accessModel.keyMapPolicyName(names.keyMapTable),
      database: sourceDatabase,
      table: names.keyMapTable,
      predicate: accessModel.keyMapSelfFilter(names),
    };
    const tablePolicies = viewProvisioning
      .sourceTables({ names, sourceDatabase, views })
      .map((table): LwqlRowPolicyTarget => ({
        name: accessModel.rowPolicyName(table.table),
        database: table.database ?? names.database,
        table: table.table,
        predicate: accessModel.tenantPredicate({
          names,
          tenantColumn: table.tenantColumn,
          sourceDatabase,
        }),
      }));
    return [keyMapPolicy, ...tablePolicies];
  }

  /** SELECT on, and one tenant policy over, each tenant table; no other grant (ADR-202). */
  #appReader({
    passwordSha256Hex,
    enforce = false,
    sourceDatabase,
  }: {
    passwordSha256Hex: string;
    enforce?: boolean;
    sourceDatabase: string;
  }): LwqlAccessIdentity {
    return {
      user: { name: APP_READER_NAMES.user, passwordSha256Hex },
      profile: {
        name: APP_READER_NAMES.settingsProfile,
        settings: this.appReaderProfileSettings({ enforce }),
      },
      grants: APP_READER_TENANT_TABLES.map(({ table }) => ({ database: sourceDatabase, table })),
      rowPolicies: APP_READER_TENANT_TABLES.map(({ table, tenantColumn }) => ({
        name: accessModel.appReaderPolicyName(table),
        database: sourceDatabase,
        table,
        predicate: accessModel.appReaderTenantPredicate({ tenantColumn }),
      })),
    };
  }
}
