export {
  PostgresSuiteAdapter,
  type PostgresSuiteAdapterOptions,
} from "./adapters/postgres.suite.adapter";
export type {
  SuiteEventingCapabilities,
  SuiteRuntimeAdapter,
} from "./adapters/suite-runtime.adapter";
export {
  ClickHouseSuiteEventingAdapter,
  type ClickHouseSuiteEventingAdapterOptions,
} from "./adapters/clickhouse.suite-eventing.adapter";
export {
  ClickHouseSuiteRunProcessingAdapter,
  type ClickHouseSuiteRunProcessingAdapterOptions,
} from "./adapters/clickhouse.suite-run-processing.adapter";
export {
  SuiteExecutionPort,
  SuiteRunCommandsPort,
  SuiteRunIdPort,
  type QueueSimulationRunCommandData,
} from "./ports/suite-execution.port";
export { SuiteExecutionService } from "./services/suite-execution.service";
export type { SuiteClickHouseClient } from "./ports/suite-clickhouse.port";
export {
  CompleteSuiteRunItemCommand,
  RecordSuiteRunItemStartedCommand,
  StartSuiteRunCommand,
} from "./adapters/suite-run-commands.adapter";
export {
  createSuiteRunProcessingPipeline,
  type SuiteRunProcessingPipeline,
  type SuiteRunProcessingPipelineDeps,
} from "./adapters/suite-run-processing.adapter";
export {
  SUITE_RUN_PROJECTION_VERSIONS,
  type CompleteSuiteRunItemCommandData,
  type RecordSuiteRunItemStartedCommandData,
  type StartSuiteRunCommandData,
} from "@langwatch/suite-contract";
export { SuiteTrpcApi } from "./transport/api-trpc/suite.api";
export type { SuiteTrpcContext, SuiteTrpcProcedures } from "./transport/api-trpc/suite.trpc-context";

/**
 * The feature's application: the one object both of its doors call, and the
 * refusal it names. The process composes it from the four services the suite
 * surface reads across — what the `SuiteApplication` bag used to describe.
 */
export {
  OrganizationNotFoundForProjectError,
  SuiteApp,
  type SuiteAppDependencies,
  type SuiteOrFolder,
} from "./app/suite.app";

/**
 * The app-process REST family this feature owns. The process supplies the
 * bound REST security service, a resolver for the application and its own
 * platform-URL builder; the base path, access declarations, schemas and
 * delegation are the feature's.
 */
export { createSuiteRestApp } from "./transport/api-rest/suite.api";
