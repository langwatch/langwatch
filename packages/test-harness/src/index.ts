/**
 * `@langwatch/test-harness` — the harness every process shares: lane assignment, shard weighting, static-scan compiler access, and datastore wiring. A file lands in COMPONENT when it declares `@vitest-environment jsdom` and names no datastore, DATASTORE otherwise; both configs call {@link laneForSource} so the lanes stay exact complements.
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
export {
  hardFloorReport,
  resolveHardFloorMs,
  setup as armUnitShardHardFloor,
} from "./unit-shard-hard-floor";
export { createWeigher, loadDurationManifest, type DurationManifest } from "./shard-weights";
export { scanTestSourceForUnsafeDeleteMany, type TeardownViolation } from "./teardown-scan";
export { closeTsAstSession, parseSourceText, parseSourceTexts } from "./ts-ast";
export { aliasesForFile, parseVitestConfigAliases, type ModuleAlias } from "./vitest-alias-table";
export * from "./nlpgo-binary-stamp";
export * from "./nlpgo-subprocess";
