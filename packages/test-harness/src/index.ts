/**
 * Test harness: lane assignment, shard weighting, compiler, datastore wiring.
 * See {@link laneForSource} for COMPONENT vs DATASTORE lane split.
 */
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
export {
  frozenAt,
  memoryCache,
  memoryIdempotency,
  memoryRateLimiter,
  recordingMail,
  recordingTelemetry,
  type Cache,
  type Clock,
  type FrozenClock,
  type IdempotencyStore,
  type Mail,
  type MailMessage,
  type RateLimiter,
  type RecordedMetric,
  type RecordingMail,
  type RecordingTelemetry,
  type Telemetry,
} from "./member-doubles.ts";
export { createTestAuditSink, type TestAuditRow, type TestAuditSink } from "./test-audit-sink.ts";
export { createTestLogger, type TestLogLine, type TestLogLines } from "./test-logger.ts";
export { allowConsole } from "@langwatch/vitest-config/console-guard";
export { closeTsAstSession, parseSourceText, parseSourceTexts } from "./ts-ast.ts";
export {
  aliasesForFile,
  parseVitestConfigAliases,
  type ModuleAlias,
} from "./vitest-alias-table.ts";
