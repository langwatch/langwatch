/**
 * The one typed LangWatchQL access model and its two emitters: SQL DDL for a SQL-driven
 * access store, and the users.d/config.d YAML a config-store ClickHouse loads (ADR-159).
 * @see specs/lwql/access-model.feature
 */

import {
  DEFAULT_LWQL_RESOURCE_LIMITS,
  type LangWatchQLResourceLimits,
} from "@langwatch/analytics-contract/langwatch-ql-limits";

import { clickHouseLiteral } from "../rules/langwatch-ql-sql-literal.rules.ts";
import { LWQL_VIEW_CATALOG } from "../rules/lwql-view-catalog.rules.ts";
import {
  LangWatchQLAccessModelService,
  type LangWatchQLNames,
} from "./langwatch-ql-access-model.service.ts";
import {
  LangWatchQLCatalogShapesService,
  type LangWatchQLViewDefinition,
} from "./langwatch-ql-catalog-shapes.service.ts";
import type { PostgresNamedCollection } from "./langwatch-ql-postgres-mapping.service.ts";
import { LangWatchQLSqlTextService } from "./langwatch-ql-sql-text.service.ts";
import { LangWatchQLViewProvisioningService } from "./langwatch-ql-view-provisioning.service.ts";
import { LangWatchQLViewStatementsService } from "./langwatch-ql-view-statements.service.ts";

const accessModel = LangWatchQLAccessModelService.create();
const catalogShapes = LangWatchQLCatalogShapesService.create();
const sqlText = LangWatchQLSqlTextService.create();
const viewProvisioning = LangWatchQLViewProvisioningService.create();
const viewStatements = LangWatchQLViewStatementsService.create();

export const LWQL_CUSTOM_SETTINGS_PREFIX = "custom_";
export const LWQL_USERS_D_RELATIVE_PATH = "users.d/lwql-access.yaml";
export const LWQL_CONFIG_D_RELATIVE_PATH = "config.d/lwql-named-collection.yaml";

const LWQL_USER_NETWORKS_IP = "::/0";

/** One settings-profile entry; `quoted` values are strings, the rest numbers. */
export interface LwqlProfileSetting {
  readonly name: string;
  readonly value: string | number;
  readonly quoted?: boolean;
  readonly constraint: "const" | "changeable_in_readonly";
}

/** A SELECT grant; `columns` narrows it to a column list. */
export interface LwqlGrantTarget {
  readonly database: string;
  readonly table: string;
  readonly columns?: readonly string[];
}

export interface LwqlRowPolicyTarget {
  readonly name: string;
  readonly database: string;
  readonly table: string;
  readonly predicate: string;
}

export interface LwqlAccessModelDefinition {
  readonly customSettingsPrefix: string;
  readonly user: { readonly name: string; readonly passwordSha256Hex: string };
  readonly profile: { readonly name: string; readonly settings: readonly LwqlProfileSetting[] };
  readonly grants: readonly LwqlGrantTarget[];
  readonly rowPolicies: readonly LwqlRowPolicyTarget[];
  readonly namedCollection: PostgresNamedCollection;
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

function settingYamlValue(setting: LwqlProfileSetting): YamlValue {
  if (!setting.quoted) return Number(setting.value);
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

  /** The tenant setting starts empty (zero rows, never all rows); everything else is `CONST`. */
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
    ];
  }

  build({
    names,
    passwordSha256Hex,
    namedCollection,
    sourceDatabase,
    limits = DEFAULT_LWQL_RESOURCE_LIMITS,
    views = LWQL_VIEW_CATALOG,
  }: {
    names: LangWatchQLNames;
    passwordSha256Hex: string;
    namedCollection: PostgresNamedCollection;
    sourceDatabase: string;
    limits?: LangWatchQLResourceLimits;
    views?: readonly LangWatchQLViewDefinition[];
  }): LwqlAccessModelDefinition {
    return {
      customSettingsPrefix: LWQL_CUSTOM_SETTINGS_PREFIX,
      user: { name: names.restrictedUser, passwordSha256Hex },
      profile: { name: names.settingsProfile, settings: this.profileSettings({ names, limits }) },
      grants: this.#grants({ names, sourceDatabase, views }),
      rowPolicies: this.#rowPolicies({ names, sourceDatabase, views }),
      namedCollection,
    };
  }

  /** Profile, user, row policies, then grants — the order a SQL access store needs. */
  renderDdl(definition: LwqlAccessModelDefinition): string[] {
    const user = definition.user.name;
    const settings = definition.profile.settings
      .map(
        (setting) => `${setting.name} = ${settingLiteral(setting)} ${settingConstraint(setting)}`,
      )
      .join(",\n           ");
    return [
      `CREATE SETTINGS PROFILE OR REPLACE ${definition.profile.name}\n  SETTINGS ${settings}`,
      `CREATE USER OR REPLACE ${user} ` +
        `IDENTIFIED WITH sha256_hash BY '${definition.user.passwordSha256Hex}' ` +
        `SETTINGS PROFILE ${definition.profile.name}`,
      ...definition.rowPolicies.map(
        (policy) =>
          `CREATE ROW POLICY OR REPLACE ${policy.name} ON ${policy.database}.${policy.table}\n` +
          `  USING ${policy.predicate}\n` +
          `  TO ${user}`,
      ),
      ...definition.grants.map(
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

  renderUsersD(definition: LwqlAccessModelDefinition): string {
    const settings: Record<string, YamlValue> = {};
    const constraints: Record<string, YamlValue> = {};
    for (const setting of definition.profile.settings) {
      settings[setting.name] = settingYamlValue(setting);
      constraints[setting.name] = { [setting.constraint]: "" };
    }
    const databases: Record<string, Record<string, YamlValue>> = {};
    for (const policy of definition.rowPolicies) {
      const tables = (databases[policy.database] ??= {});
      tables[policy.table] = { filter: policy.predicate };
    }
    return yamlDocument({
      profiles: { [definition.profile.name]: { ...settings, constraints } },
      users: {
        [definition.user.name]: {
          password_sha256_hex: definition.user.passwordSha256Hex,
          networks: { ip: LWQL_USER_NETWORKS_IP },
          profile: definition.profile.name,
          grants: {
            query: definition.grants.map(
              (grant) => `GRANT ${selectClause(grant)} ON ${grant.database}.${grant.table}`,
            ),
          },
          databases,
        },
      },
    });
  }

  renderNamedCollectionConfig(definition: LwqlAccessModelDefinition): string {
    const collection = definition.namedCollection;
    return yamlDocument({
      named_collections: {
        [collection.collection]: {
          host: collection.host,
          port: collection.port,
          database: collection.database,
          user: collection.user,
          password: collection.password,
        },
      },
    });
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
}
