export { SuiteRuntimePort, type SuiteEventingCapabilities } from "./repositories/suite-eventing.repository.ts";
export {
  ClickhouseSuiteEventingRepository as ClickHouseSuiteEventingAdapter,
  type ClickHouseSuiteEventingAdapterOptions,
} from "./repositories/clickhouse/clickhouse.suite-eventing.repository.ts";
export {
  RedisSuiteRunProcessingRepository as ClickHouseSuiteRunProcessingAdapter,
  type ClickHouseSuiteRunProcessingAdapterOptions,
} from "./repositories/redis/redis.suite-run-processing.repository.ts";
export {
  SuiteExecutionPort,
  SuiteRunCommandsPort,
  SuiteRunIdPort,
  type QueueSimulationRunCommandData,
} from "./ports/suite-execution.port.ts";
export { SuiteExecutionService } from "./services/suite-execution.service.ts";
export {
  SuiteRunModelsService,
  type SuiteRunModelsResolver,
} from "./services/suite-run-models.service.ts";
export {
  ConnectedTargetService,
  type AgentOwnerNameReader,
  type ConnectedPresenceReader,
  type ConnectedTargetAgent,
  type ConnectedTargetReferenceReader,
} from "./services/connected-target.service.ts";
export type { SuiteClickHouseClient } from "./repositories/clickhouse-client.repository.ts";
export {
  CompleteSuiteRunItemCommand,
  RecordSuiteRunItemStartedCommand,
  StartSuiteRunCommand,
  SuiteRunCommandsAdapter,
} from "./services/suite-run-commands.service.ts";
export {
  SuiteRunProcessingPipelineAdapter,
  type SuiteRunProcessingPipeline,
  type SuiteRunProcessingPipelineDeps,
} from "./services/suite-run-processing.service.ts";
export { SuiteRunProcessingProducerAdapter } from "./services/suite-run-processing-producer.service.ts";
export {
  SUITE_RUN_PROJECTION_VERSIONS,
  type CompleteSuiteRunItemCommandData,
  type RecordSuiteRunItemStartedCommandData,
  type StartSuiteRunCommandData,
} from "@langwatch/suite-contract";
export { suiteTrpcTransport } from "./transport/suite.trpc.ts";
export { testSuiteTrpcTransport } from "./transport/test-suite.trpc.ts";

/**
 * The feature's application: the one object both of its doors call, and the
 * refusal it names. The process composes it from the four services the suite
 * surface reads across — what the `SuiteApplication` bag used to describe.
 */
export {
  OrganizationNotFoundForProjectError,
  SuiteApp,
  type SuiteAppDependencies,
  type SuiteAppInfrastructure,
  type SuiteOrTestSuite,
} from "./app/suite.app.ts";
export { suiteServer } from "./suite.server.ts";

/**
 * The Postgres backend of the tables this feature owns. The process installs it
 * through the feature's own registry; a test that composes {@link SuiteApp}
 * against a real database names it directly.
 */
export { PostgresSuiteRepositories } from "./repositories/prisma/prisma.suite.repositories.ts";
export type { SuiteRepositories } from "./repositories/suite.repositories.ts";

/**
 * The three REST families this feature declares, each taking the process's own
 * platform-URL builder: the two published v1 families — a run plan is what you
 * run, a test suite is what it runs against — and the deprecated `/api/suites`
 * alias that predates the split. All three are served from the same
 * {@link SuiteApp} the tRPC surface is.
 */
export { createRunPlansRest } from "./transport/run-plans.rest.ts";
export { createTestSuitesRest } from "./transport/test-suites.rest.ts";
export { createSuitesAliasRest, suitesAliasErrorHandler } from "./transport/suites-alias.rest.ts";
/** The header every suite family records the surface of a run from. */
export { suiteSurfaceFact } from "./rules/suite-wire-v1.rules.ts";
