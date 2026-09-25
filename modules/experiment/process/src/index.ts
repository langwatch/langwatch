/**
 * The persistence-and-orchestration service, folded out of the contract
 * package (ADR-133: no standalone contract-service class). Peer compositions
 * still import the full surface's type from here.
 */
export type { ExperimentServiceOptions } from "./services/experiment.service.ts";
export { ExperimentDspyRetentionRepository } from "./repositories/experiment-dspy-retention.repository.ts";
export type { ExperimentDatabase } from "./repositories/prisma/prisma.experiment.repository.ts";
export type { ExperimentWorkflowVersionDatabase } from "./repositories/prisma/prisma.experiment-workflow-version.repository.ts";
export {
  RedisExperimentRunProcessingRepository,
  type ClickHouseExperimentRunProcessingAdapterOptions,
} from "./repositories/redis/redis.experiment-run-processing.repository.ts";
export {
  ClickHouseExperimentRunProcessingRepository,
  type ExperimentRunProcessingPipeline,
  type ExperimentRunEventingIdLookup,
  type ExperimentRunEventingResultRecord,
  type ExperimentRunEventingState,
  type ExperimentRunEventingStateRepository,
  type ClickhouseExperimentRunProcessingRepository,
} from "./repositories/clickhouse/clickhouse.experiment-run-processing.repository.ts";
export type {
  ExperimentAppDependencies,
  ExperimentModelCosts,
  ExperimentBroadcast,
  ExperimentMonitorCascade,
  ExperimentPeople,
  ExperimentPermissions,
  ExperimentWorkflowAuthoring,
} from "./app/experiment.app.ts";
export { experimentServer } from "./experiment.server.ts";
export { experimentTrpcTransport } from "./transport/experiment.trpc.ts";
export { experimentRest, experimentRestCredential } from "./transport/experiment.rest.ts";
export { ExperimentWorkbenchUpdates } from "./services/experiment-workbench.service.ts";

/**
 * The workbench run loop, moved WHOLE out of the retired application.
 */
export { createSemaphore } from "./eventing/experiment-run-semaphore.process.ts";
export {
  buildStripScoreEvaluatorIds,
  shouldStripScore,
} from "./eventing/experiment-evaluator-score-filter.process.ts";
export { ExperimentConnectedDispatch } from "./services/experiment-connected-cell.service.ts";
export {
  ExperimentConnectedAgentOwnership,
  type ExperimentConnectedAgentSubject,
} from "./services/experiment-run-driver.service.ts";

export { ExperimentEvaluationReporting } from "./services/experiment-run-storage.service.ts";
export type {
  ExperimentRunProgressFailure,
  ExperimentRunProgressState,
  ExperimentRunProgressSummary,
} from "./repositories/experiment-run-progress.repository.ts";
export { ExperimentSandboxCredential } from "./services/experiment-run-sandbox-key.service.ts";
export { ExperimentStudioDispatch } from "./services/experiment-cell-execution.service.ts";

export type {
  ExperimentRunCollaborators,
  OrchestratorInput,
} from "./rules/experiment-run-input.rules.ts";
export type { StartPollingRunInput } from "./services/experiment-polling-run.service.ts";
export type {
  RunResultsPersistence,
  RunResultsWriter,
} from "./services/experiment-run-results-writer.service.ts";
export type {
  SavedStateExecution,
  SavedStateExecutionRefusal,
} from "./services/experiment-saved-state-execution.service.ts";
export type {
  ExecutionDataInputs,
  ExecutionDataServices,
  LoadedDataset,
  LoadedExecutionData,
  LoadedWorkflow,
} from "./services/experiment-execution-data.service.ts";
export type { RunStateMirror } from "./services/experiment-run-state-mirror.service.ts";
export {
  extractTargetOutput,
  mapNlpEvent,
  mapThrownErrorEvent,
  mapWorkflowEvaluatorResult,
  type ResultMapperConfig,
} from "./eventing/experiment-result-mapping.process.ts";
export {
  buildCellWorkflow,
  buildEvaluatorCellWorkflow,
} from "./eventing/experiment-cell-workflow.process.ts";
export {
  experimentV3Rest,
  type ExperimentV3RestApi,
  experimentWorkbenchCredential,
} from "./transport/experiment-v3.rest.ts";
export type {
  ExperimentV3RunLoop,
  ExperimentV3StartRunInput,
  ExperimentWorkbenchObserver,
} from "./app/experiment-workbench.members.ts";
export { experimentWorkbenchRunRest } from "./transport/experiment-workbench-run.rest.ts";
export type { ExperimentFindOrCreateInput } from "./services/experiment-find-or-create.service.ts";
export { experimentInitRest, experimentInitCaller } from "./transport/experiment-init.rest.ts";
export {
  experimentDspyStepsRest,
  dspyStepsCaller,
} from "./transport/experiment-dspy-steps.rest.ts";
