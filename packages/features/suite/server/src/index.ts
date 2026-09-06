export {
  PostgresSuiteAdapter,
  type PostgresSuiteAdapterOptions,
} from "./adapters/postgres.suite.adapter.ts";
export { SuiteRuntimePort, type SuiteEventingCapabilities } from "./ports/suite-runtime.port.ts";
export {
  ClickHouseSuiteEventingAdapter,
  type ClickHouseSuiteEventingAdapterOptions,
} from "./adapters/clickhouse.suite-eventing.adapter.ts";
export {
  ClickHouseSuiteRunProcessingAdapter,
  type ClickHouseSuiteRunProcessingAdapterOptions,
} from "./adapters/clickhouse.suite-run-processing.adapter.ts";
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
export type { SuiteClickHouseClient } from "./ports/suite-clickhouse.port.ts";
export {
  CompleteSuiteRunItemCommand,
  RecordSuiteRunItemStartedCommand,
  StartSuiteRunCommand,
  SuiteRunCommandsAdapter,
} from "./adapters/suite-run-commands.adapter.ts";
export {
  SuiteRunProcessingPipelineAdapter,
  type SuiteRunProcessingPipeline,
  type SuiteRunProcessingPipelineDeps,
} from "./adapters/suite-run-processing.adapter.ts";
export { SuiteRunProcessingProducerAdapter } from "./adapters/suite-run-processing-producer.adapter.ts";
export {
  SUITE_RUN_PROJECTION_VERSIONS,
  type CompleteSuiteRunItemCommandData,
  type RecordSuiteRunItemStartedCommandData,
  type StartSuiteRunCommandData,
} from "@langwatch/suite-contract";
export { SuiteTrpcApi } from "./transport/api-trpc/suite.api.ts";
export type { SuiteTrpcContext, SuiteTrpcProcedures } from "./rules/suite-trpc-context.rules.ts";

/**
 * The feature's application: the one object both of its doors call, and the
 * refusal it names. The process composes it from the four services the suite
 * surface reads across — what the `SuiteApplication` bag used to describe.
 */
export {
  OrganizationNotFoundForProjectError,
  SuiteApp,
  type SuiteAppDependencies,
  type SuiteOrTestSuite,
} from "./app/suite.app.ts";

/**
 * The app-process REST family this feature owns. The process supplies the bound REST
 * security service, a resolver for the application and its own platform-URL builder; the
 * base path, access declarations, schemas and delegation are the feature's.
 */
export { createSuiteRestApp } from "./transport/api-rest/suite.api.ts";
/**
 * The two v1 REST families, split by what they publish: a run plan is what
 * you run, a test suite is what it runs against. Both are served from the
 * same {@link SuiteApp} the tRPC surface and `/api/suites` are.
 */
export { createRunPlansV1RestApp } from "./transport/api-rest/run-plans-v1.api.ts";
export { createTestSuitesV1RestApp } from "./transport/api-rest/test-suites-v1.api.ts";
