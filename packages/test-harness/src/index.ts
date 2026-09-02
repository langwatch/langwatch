/**
 * `@langwatch/test-harness` — the test harness every LangWatch process shares.
 *
 * These modules were `platform/app/src/test-utils`, and they moved as a unit
 * because they answer questions ABOUT a test run rather than about any one
 * feature: which lane a file belongs in, how a shard is weighted, what a
 * static scan is allowed to reach the TypeScript compiler through, and which
 * datastores an integration suite is handed.
 *
 * The lane rule is the reason this is a package rather than three copies. A
 * file lands in the COMPONENT lane when it declares `@vitest-environment
 * jsdom` and names no datastore, and in the DATASTORE lane otherwise; the two
 * configs that select tests both call {@link laneForSource}, which is what
 * makes the lanes exact complements and stops a file dropping out of CI.
 * Three processes each deciding that for themselves is three chances for a
 * file to be in neither.
 *
 * `@langwatch/prisma-client/generated` replaced the application's
 * `~/generated/prisma/client` at the one seam that named it: the row cleanup
 * takes a typed client rather than reaching for a singleton.
 */
export { cleanupTestRows, requireAssigned, type CleanupEntry } from "./cleanup-test-rows";
export {
  nativeClickHouseBaseUrl,
  privateRouteOrgId,
  startTestClickHouseEndpoints,
  TEST_CLICKHOUSE_IMAGE,
  TEST_CLICKHOUSE_TUNING,
  TEST_CLICKHOUSE_TUNING_LABEL,
  type TestClickHouseEndpoint,
} from "./clickhouse-test-endpoints";
export {
  default as DurationManifestReporter,
  mergeDurations,
  type DurationManifestReporterOptions,
} from "./duration-manifest-reporter";
export {
  assertSerialWorkerSlot,
  integrationFilesRunInParallel,
  withdrawWorkerCountOverride,
} from "./integration-file-concurrency";
export {
  escapeGlob,
  INTEGRATION_SEARCH_DIRS,
  laneForSource,
  partitionIntegrationFiles,
  toIncludePatterns,
  type Lane,
  type LanePartition,
} from "./integration-lanes";
export {
  graphLaneForSource,
  graphLaneSelection,
  partitionByModuleGraph,
  selectedGraphLane,
  type GraphLane,
  type GraphPartition,
} from "./integration-module-graph";
export {
  mightContainMockCall,
  resolveMockSpecifier,
  scanSourceForMockSpecifiers,
  type MockSpecifierResolution,
  type MockSpecifierSite,
} from "./mock-specifier-scan";
export {
  default as ShardFailureReporter,
  recordShardSelection,
  resetShardState,
  shardModuleTally,
  shardSawFailure,
} from "./shard-failure-reporter";
export { createWeigher, loadDurationManifest, type DurationManifest } from "./shard-weights";
export { scanTestSourceForUnsafeDeleteMany, type TeardownViolation } from "./teardown-scan";
export { closeTsAstSession, parseSourceText, parseSourceTexts } from "./ts-ast";
export { aliasesForFile, parseVitestConfigAliases, type ModuleAlias } from "./vitest-alias-table";
