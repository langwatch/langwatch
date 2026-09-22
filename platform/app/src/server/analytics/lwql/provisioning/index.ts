/**
 * LangWatchQL provisioning — the public surface of the access-model deploy path.
 *
 * External consumers reach for this barrel and nothing deeper: the production
 * deploy task, the project service that writes the key map, and the API-route
 * integration suites that provision a container. The individual modules
 * (`accessModel.ts`, `catalogStatements.ts`, `postgresMapping.ts`,
 * `productionProvisioning.ts`, `selfProvisioning.ts`) are the subsystem's own
 * business; only what a caller outside `provisioning/` actually uses is
 * re-exported here.
 *
 * Deliberately not on the query path. The runtime executor derives its
 * connection from `../connection` and its ceilings from `../limits`, so it
 * never loads this barrel — importing it would pull the whole deploy-time graph
 * (the view catalog, the statement builders) onto every query boot, the exact
 * coupling this module keeps out.
 *
 * @see specs/lwql/api.feature
 */

export { KEY_MAP_COLUMNS, type LangWatchQLNames } from "./accessModel";
export {
  type LangWatchQLAppFunctionConflict,
  type LangWatchQLServerFunctionRow,
  lwqlAppFunctionConflicts,
  lwqlAppFunctionCreateQuery,
  lwqlAppFunctionReconciliationQuery,
} from "./appFunctionStatements";
export {
  lwqlViewSetupStatements,
  SHIPPED_LWQL_DEDUP,
} from "./catalogStatements";
export {
  CLICKHOUSE_CONFIG_STORE_ERROR_CODE,
  type ConfigStoreLwqlEntity,
  inventoryConfigStoreLwqlEntities,
  type RunClickHouseStatementsResult,
  redactSecrets,
  runClickHouseStatements,
  type SkippedProvisioningStatement,
} from "./clickhouseStatementRunner";
export {
  LWQL_POSTGRES_READER_ROLE,
  type LwqlKeyMapBackfillPlan,
  type LwqlKeyMapRow,
  lwqlKeyMapTableQualifiedName,
  lwqlPostgresSchemaFromDatabaseUrl,
  planLwqlKeyMapBackfill,
  productionLangWatchQLNames,
  productionPostgresApprovedViewStatements,
  withTenancyOptOut,
} from "./productionProvisioning";
export {
  canProvisionAppFunctions,
  type LwqlSelfProvisionEnv,
  lwqlPostgresEndpointFromDatabaseUrl,
  lwqlSelfProvisionFromEnv,
  probeAppFunctionStore,
  selfHostedClickHouseProvisioningStatements,
  selfHostedPostgresReaderStatements,
} from "./selfProvisioning";
export { withLwqlSelfProvisionLock } from "./selfProvisionLock";
