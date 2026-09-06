/**
 * `@langwatch/test-harness` — the harness every process shares: lane assignment, shard weighting, static-scan compiler access, and datastore wiring. A file lands in COMPONENT when it declares `@vitest-environment jsdom` and names no datastore, DATASTORE otherwise; both configs call {@link laneForSource} so the lanes stay exact complements.
 */
export { cleanupTestRows, requireAssigned, type CleanupEntry } from "./cleanup-test-rows.ts";
export {
  migrateTestClickHouseOnce,
  nativeClickHouseBaseUrl,
  privateRouteOrgId,
  startTestClickHouseEndpoints,
  TEST_CLICKHOUSE_IMAGE,
  TEST_CLICKHOUSE_TUNING,
  TEST_CLICKHOUSE_TUNING_LABEL,
  type TestClickHouseEndpoint,
} from "./clickhouse-test-endpoints.ts";
export {
  default as DurationManifestReporter,
  mergeDurations,
  type DurationManifestReporterOptions,
} from "./duration-manifest-reporter.ts";
export {
  assertSerialWorkerSlot,
  integrationFilesRunInParallel,
  withdrawWorkerCountOverride,
} from "./integration-file-concurrency.ts";
export {
  escapeGlob,
  INTEGRATION_SEARCH_DIRS,
  laneForSource,
  partitionIntegrationFiles,
  toIncludePatterns,
  type Lane,
  type LanePartition,
} from "./integration-lanes.ts";
export {
  graphLaneForSource,
  graphLaneSelection,
  partitionByModuleGraph,
  selectedGraphLane,
  type GraphLane,
  type GraphPartition,
} from "./integration-module-graph.ts";
export {
  mightContainMockCall,
  resolveMockSpecifier,
  scanSourceForMockSpecifiers,
  type MockSpecifierResolution,
  type MockSpecifierSite,
} from "./mock-specifier-scan.ts";
export {
  default as ShardFailureReporter,
  recordShardSelection,
  resetShardState,
  shardModuleTally,
  shardSawFailure,
} from "./shard-failure-reporter.ts";
export {
  hardFloorReport,
  resolveHardFloorMs,
  setup as armUnitShardHardFloor,
} from "./unit-shard-hard-floor.ts";
export { createWeigher, loadDurationManifest, type DurationManifest } from "./shard-weights.ts";
export { scanTestSourceForUnsafeDeleteMany, type TeardownViolation } from "./teardown-scan.ts";
export { closeTsAstSession, parseSourceText, parseSourceTexts } from "./ts-ast.ts";
export { aliasesForFile, parseVitestConfigAliases, type ModuleAlias } from "./vitest-alias-table.ts";
export * from "./nlpgo-binary-stamp.ts";
export * from "./nlpgo-subprocess.ts";
