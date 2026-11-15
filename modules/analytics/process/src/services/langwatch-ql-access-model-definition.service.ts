/**
 * LangWatchQL's access model (ADR-159) beside the app's identities (ADR-202), which with both
 * emitters come from `@langwatch/clickhouse-migrations`: SQL DDL for a SQL access store,
 * users.d/config.d YAML for a config-store ClickHouse.
 * @see specs/lwql/access-model.feature · specs/clickhouse/app-reader-row-policies.feature
 */

import {
  DEFAULT_LWQL_RESOURCE_LIMITS,
  type LangWatchQLResourceLimits,
} from "@langwatch/analytics-contract/langwatch-ql-limits";
import {
  type AccessGrant,
  type AccessIdentity,
  type AccessProfileSetting,
  type AccessRowPolicy,
  APP_READER_SETTINGS_PREFIX,
  appReaderEnforcingIdentity,
  appReaderIdentity,
  type AppWriterInput,
  appWriterIdentity,
  hiddenSystemTablePolicies,
  renderIdentitiesUsersD,
  renderIdentityDdl,
  yamlDocument,
  type YamlValue,
} from "@langwatch/clickhouse-migrations";

import type { PostgresNamedCollection } from "../features/provisioning/services/langwatch-ql-postgres-mapping.service.ts";
import { LangWatchQLViewProvisioningService } from "../features/provisioning/services/langwatch-ql-view-provisioning.service.ts";
import { LangWatchQLViewStatementsService } from "../features/provisioning/services/langwatch-ql-view-statements.service.ts";
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
/** Where the rendered access model lands under the ClickHouse config root. */
export const LWQL_USERS_D_RELATIVE_PATH = "users.d/lwql-access.yaml";
export const LWQL_CONFIG_D_RELATIVE_PATH = "config.d/lwql-named-collection.yaml";

export interface LwqlAccessModelDefinition extends AccessIdentity {
  readonly customSettingsPrefix: string;
  readonly namedCollection: PostgresNamedCollection;
  /** Further names config.d delivers with the same connection, for tables bound to them. */
  readonly namedCollectionAliases: readonly string[];
  /** The application's restricted reader (ADR-202), once its credential is supplied. */
  readonly appReader?: AccessIdentity;
  /** The shadow sampler's reader: the app reader's policies with enforce pinned on. */
  readonly appReaderEnforcing?: AccessIdentity;
  /** The api's insert-only writer (ADR-202 Decided 12), once its credential is supplied. */
  readonly appWriter?: AccessIdentity;
}

export interface RenderedConfigFile {
  readonly relativePath: string;
  readonly contents: string;
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
  }): AccessProfileSetting[] {
    const constant = (
      name: string,
      value: string | number,
      quoted = false,
    ): AccessProfileSetting =>
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

  build({
    names,
    passwordSha256Hex,
    namedCollection,
    namedCollectionAliases = [],
    sourceDatabase,
    limits = DEFAULT_LWQL_RESOURCE_LIMITS,
    views = LWQL_VIEW_CATALOG,
    appReader,
    appWriter,
  }: {
    names: LangWatchQLNames;
    passwordSha256Hex: string;
    namedCollection: PostgresNamedCollection;
    namedCollectionAliases?: readonly string[];
    sourceDatabase: string;
    limits?: LangWatchQLResourceLimits;
    views?: readonly LangWatchQLViewDefinition[];
    /**
     * The app reader's credential hash; `enforce` defaults to shadow (ADR-202 Rollout). With
     * `enforcing`, the shadow sampler's reader too, its profile pinning enforce on.
     */
    appReader?: {
      passwordSha256Hex: string;
      enforce?: boolean;
      enforcing?: { passwordSha256Hex: string };
    };
    /** The api's insert-only writer's credential hash (ADR-202 Decided 12). */
    appWriter?: AppWriterInput;
  }): LwqlAccessModelDefinition {
    return {
      customSettingsPrefix: LWQL_CUSTOM_SETTINGS_PREFIX,
      user: { name: names.restrictedUser, passwordSha256Hex },
      profile: { name: names.settingsProfile, settings: this.profileSettings({ names, limits }) },
      grants: this.#grants({ names, sourceDatabase, views }),
      rowPolicies: this.#rowPolicies({ names, sourceDatabase, views }),
      namedCollection,
      namedCollectionAliases,
      ...(appReader ? { appReader: appReaderIdentity({ ...appReader, sourceDatabase }) } : {}),
      ...(appReader?.enforcing
        ? {
            appReaderEnforcing: appReaderEnforcingIdentity({
              ...appReader.enforcing,
              sourceDatabase,
            }),
          }
        : {}),
      ...(appWriter ? { appWriter: appWriterIdentity({ ...appWriter, sourceDatabase }) } : {}),
    };
  }

  /** Per identity, LangWatchQL's first: profile, user, row policies, then grants. */
  renderDdl(definition: LwqlAccessModelDefinition): string[] {
    return identitiesOf(definition).flatMap((identity) => renderIdentityDdl({ identity }));
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
    return renderIdentitiesUsersD({
      identities: identitiesOf(definition),
      customSettingsPrefixes: [LWQL_CUSTOM_SETTINGS_PREFIX, APP_READER_SETTINGS_PREFIX],
    });
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
    return yamlDocument({ tree: { named_collections: named } });
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
  }): AccessGrant[] {
    const grants: AccessGrant[] = [{ database: sourceDatabase, table: names.keyMapTable }];
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
  }): AccessRowPolicy[] {
    const keyMapPolicy: AccessRowPolicy = {
      name: accessModel.keyMapPolicyName(names.keyMapTable),
      database: sourceDatabase,
      table: names.keyMapTable,
      predicate: accessModel.keyMapSelfFilter(names),
    };
    const tablePolicies = viewProvisioning
      .sourceTables({ names, sourceDatabase, views })
      .map((table): AccessRowPolicy => ({
        name: accessModel.rowPolicyName(table.table),
        database: table.database ?? names.database,
        table: table.table,
        predicate: accessModel.tenantPredicate({
          names,
          tenantColumn: table.tenantColumn,
          sourceDatabase,
        }),
      }));
    const hidden = hiddenSystemTablePolicies({
      policyName: (table) => accessModel.hiddenPolicyName({ names, table }),
    });
    return [keyMapPolicy, ...tablePolicies, ...hidden];
  }
}

/** LangWatchQL's identity first, then each reader the definition carries, then the writer. */
function identitiesOf(definition: LwqlAccessModelDefinition): AccessIdentity[] {
  return [
    definition,
    definition.appReader,
    definition.appReaderEnforcing,
    definition.appWriter,
  ].filter((identity) => identity !== undefined);
}
