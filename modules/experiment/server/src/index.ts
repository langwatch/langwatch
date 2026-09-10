/**
 * The persistence-and-orchestration service, folded out of the contract
 * package (ADR-133: no standalone contract-service class). Peer compositions
 * that still call the full surface directly (dataset find-or-create,
 * evaluation reporting) import the type from here now.
 */
export { ExperimentService, type ExperimentServiceOptions } from "./services/experiment.service.ts";
export { ExperimentDspyRetentionPort } from "./ports/experiment-dspy-retention.port.ts";
export { ExperimentWorkbenchUpdatesPort } from "./ports/experiment-workbench-updates.port.ts";
export { ExperimentExecutionPort } from "./ports/experiment-execution.port.ts";
export {
  PrismaExperimentRepository,
  type ExperimentDatabase,
} from "./repositories/prisma/prisma.experiment.repository.ts";
export {
  PrismaExperimentWorkflowVersionRepository,
  type ExperimentWorkflowVersionDatabase,
} from "./repositories/prisma/prisma.experiment-workflow-version.repository.ts";
export { ClickHouseExperimentRunRepository } from "./repositories/clickhouse/clickhouse.experiment-run.repository.ts";
export { ClickHouseExperimentDspyRepository } from "./repositories/clickhouse/clickhouse.experiment-dspy.repository.ts";
export {
  RedisExperimentRunProcessingRepository as ClickHouseExperimentRunProcessingAdapter,
  type ClickHouseExperimentRunProcessingAdapterOptions,
} from "./repositories/redis/redis.experiment-run-processing.repository.ts";
export {
  ExperimentEventingAdapter,
  type ExperimentRunProcessingPipeline,
  type ExperimentRunEventingIdLookup,
  type ExperimentRunEventingResultRecord,
  type ExperimentRunEventingState,
  type ExperimentRunEventingStateRepository,
  type ClickhouseExperimentRunProcessingRepository as ExperimentRunProcessingPipelineDeps,
} from "./repositories/clickhouse/clickhouse.experiment-run-processing.repository.ts";
export {
  EXPERIMENT_RUN_EVENT_TYPES,
  EXPERIMENT_RUN_PROCESSING_EVENT_TYPES,
} from "./rules/experiment-run-event-types.rules.ts";
export {
  ExperimentApp,
  type ExperimentAppDependencies,
  type ExperimentModelCosts,
  type ExperimentBroadcast,
  type ExperimentMonitorCascade,
  type ExperimentPeople,
  type ExperimentPermissions,
  type ExperimentWorkflowAuthoring,
} from "./app/experiment.app.ts";
export { experimentServer } from "./experiment.server.ts";
export { experimentTrpcTransport } from "./transport/experiment.trpc.ts";
export { experimentRest, experimentRestCredential } from "./transport/experiment.rest.ts";
export { createBlankWorkbenchState } from "./rules/experiment-blank-workbench-state.rules.ts";
export { workbenchActorFrom } from "./rules/experiment-workbench-actor.rules.ts";
export {
  createExperimentBodySchema,
  createExperimentResponseSchema,
  experimentInitBadRequestSchema,
  experimentInitForbiddenSchema,
  experimentInitResponseSchema,
  handledErrorEnvelopeSchema,
  listRunsResponseSchema,
  listWorkbenchVersionsResponseSchema,
  restoreWorkbenchVersionResponseSchema,
  runResultsResponseSchema,
  runStatusResponseSchema,
  runStatusSchema,
  saveWorkbenchStateBodySchema,
  saveWorkbenchStateResponseSchema,
  staleWorkbenchStateErrorSchema,
  startRunResponseSchema,
  workbenchStateResponseSchema,
  workbenchStateSchema,
  workbenchVersionProbeResponseSchema,
} from "./rules/experiment-schemas.rules.ts";

/**
 * The run-state fold store, composed for a process. The repository behind it
 * stays internal — see the adapter's own note.
 */
export { ClickhouseExperimentRunStateStoreRepository as ExperimentRunStateStoreAdapter } from "./repositories/clickhouse/clickhouse.experiment-run-state-store.repository.ts";

/**
 * The workbench run loop, moved WHOLE out of the retired application.
 */
export { createSemaphore } from "./processes/experiment-run-semaphore.process.ts";
export {
  buildStripScoreEvaluatorIds,
  shouldStripScore,
} from "./processes/experiment-evaluator-score-filter.process.ts";
export { getRunUrl } from "./rules/experiment-run-url.rules.ts";
export { ExperimentRunAbortRepository as ExperimentRunAbortPort } from "./repositories/experiment-run-abort.repository.ts";
export { ExperimentConnectedDispatchPort } from "./ports/experiment-connected-dispatch.port.ts";
export {
  ExperimentConnectedAgentOwnershipPort,
  type ExperimentConnectedAgentSubject,
} from "./ports/experiment-connected-agent-ownership.port.ts";
export { RedisExperimentRunAbortRepository as RedisExperimentRunAbortAdapter } from "./repositories/redis/redis.experiment-run-abort.repository.ts";

export { ExperimentEvaluationReportingPort } from "./ports/experiment-evaluation-reporting.port.ts";
export { ExperimentModelCostPort } from "./ports/experiment-model-cost.port.ts";
export {
  ExperimentRunProgressRepository as ExperimentRunProgressPort,
  type ExperimentRunProgressFailure,
  type ExperimentRunProgressState,
  type ExperimentRunProgressSummary,
} from "./repositories/experiment-run-progress.repository.ts";
export { ExperimentRunErrorReportingPort } from "./ports/experiment-run-error-reporting.port.ts";
export { ExperimentSandboxCredentialPort } from "./ports/experiment-sandbox-credential.port.ts";
export { ExperimentStudioDispatchPort } from "./ports/experiment-studio-dispatch.port.ts";
export { ExperimentTargetEntityNamesPort } from "./ports/experiment-target-entity-names.port.ts";
export { ExperimentWorkflowDslPort } from "./ports/experiment-workflow-dsl.port.ts";
export { RedisExperimentRunProgressRepository as RedisExperimentRunProgressAdapter } from "./repositories/redis/redis.experiment-run-progress.repository.ts";

export { ExperimentRunOrchestratorService } from "./services/experiment-run-orchestrator.service.ts";
export type { ExperimentRunPorts, OrchestratorInput } from "./rules/experiment-run-input.rules.ts";
export {
  ExperimentPollingRunService,
  type StartPollingRunInput,
} from "./services/experiment-polling-run.service.ts";
export {
  ExperimentRunResultsWriterService,
  type RunResultsPersistence,
  type RunResultsWriter,
} from "./services/experiment-run-results-writer.service.ts";
export {
  ExperimentSavedStateExecutionService,
  type SavedStateExecution,
  type SavedStateExecutionRefusal,
} from "./services/experiment-saved-state-execution.service.ts";
export {
  type ExecutionDataInputs,
  type ExecutionDataServices,
  ExperimentExecutionDataService,
  type LoadedDataset,
  type LoadedExecutionData,
  type LoadedWorkflow,
} from "./services/experiment-execution-data.service.ts";
export {
  ExperimentRunStateMirrorService,
  type RunStateMirror,
} from "./services/experiment-run-state-mirror.service.ts";
export { ExperimentWorkbenchTargetNamesService } from "./services/experiment-workbench-target-names.service.ts";
export {
  EvaluationInputError,
  NoCommittedVersionError,
  WorkflowEvaluationService,
  WorkflowNotFoundError,
  type WorkflowEvaluationDependencies,
  type WorkflowEvaluationOutcome,
  type WorkflowEvaluationParameters,
} from "./services/experiment-workflow-evaluation.service.ts";
export {
  extractTargetOutput,
  mapNlpEvent,
  mapThrownErrorEvent,
  mapWorkflowEvaluatorResult,
  type ResultMapperConfig,
} from "./processes/experiment-result-mapping.process.ts";
export {
  buildCellWorkflow,
  buildEvaluatorCellWorkflow,
} from "./processes/experiment-cell-workflow.process.ts";
export {
  ExperimentRunLoopUnavailableError,
  experimentV3Rest,
  experimentV3AliasRest,
  ExperimentV3RestApi,
  ExperimentV3AliasApi,
  experimentWorkbenchCredential,
  type ExperimentV3RestSession,
  type ExperimentV3RunLoop,
  type ExperimentV3StartRunInput,
} from "./transport/experiment-v3.rest.ts";
export {
  experimentWorkbenchRunRest,
  experimentWorkbenchCaller,
} from "./transport/experiment-workbench-run.rest.ts";
export {
  ExperimentFindOrCreateService,
  type ExperimentFindOrCreateInput,
} from "./services/experiment-find-or-create.service.ts";
export { experimentInitRest, experimentInitCaller } from "./transport/experiment-init.rest.ts";
export {
  experimentDspyStepsRest,
  dspyStepsCaller,
} from "./transport/experiment-dspy-steps.rest.ts";
