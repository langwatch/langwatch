export * from "./adapters/postgres.experiment.adapter.ts";
export { ExperimentDspyRetentionPort } from "./ports/experiment-dspy-retention.port.ts";
export { ExperimentWorkbenchUpdatesPort } from "./ports/experiment-workbench-updates.port.ts";
export {
  ClickHouseExperimentRunProcessingAdapter,
  type ClickHouseExperimentRunProcessingAdapterOptions,
} from "./adapters/clickhouse.experiment-run-processing.adapter.ts";
export {
  ExperimentEventingAdapter,
  type ExperimentRunProcessingPipeline,
  type ExperimentRunEventingIdLookup,
  type ExperimentRunEventingResultRecord,
  type ExperimentRunEventingState,
  type ExperimentRunEventingStateRepository,
  type ExperimentRunProcessingPipelineDeps,
} from "./adapters/eventing.experiment-run-processing.adapter.ts";
export {
  EXPERIMENT_RUN_EVENT_TYPES,
  EXPERIMENT_RUN_PROCESSING_EVENT_TYPES,
} from "./rules/experiment-run-event-types.rules.ts";
export {
  ExperimentApp,
  type ExperimentAppDependencies,
  type ExperimentBroadcast,
  type ExperimentCaller,
  type ExperimentMonitorCascade,
  type ExperimentWithRuns,
} from "./app/experiment.app.ts";
export { experimentServer } from "./experiment.server.ts";
// The tRPC transport is not exported: it still names the deleted legacy builder.
export { createExperimentsRestApp } from "./transport/api-rest/experiment.api.ts";
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
export { ExperimentRunStateStoreAdapter } from "./adapters/experiment-run-state-store.adapter.ts";

/**
 * The workbench run loop, moved WHOLE out of the retired application.
 */
export { createSemaphore } from "./processes/experiment-run-semaphore.process.ts";
export {
  buildStripScoreEvaluatorIds,
  shouldStripScore,
} from "./processes/experiment-evaluator-score-filter.process.ts";
export { getRunUrl } from "./rules/experiment-run-url.rules.ts";
export { ExperimentRunAbortPort } from "./ports/experiment-run-abort.port.ts";
export { ExperimentConnectedDispatchPort } from "./ports/experiment-connected-dispatch.port.ts";
export {
  ExperimentConnectedAgentOwnershipPort,
  type ExperimentConnectedAgentSubject,
} from "./ports/experiment-connected-agent-ownership.port.ts";
export { RedisExperimentRunAbortAdapter } from "./adapters/redis.experiment-run-abort.adapter.ts";

export { ExperimentEvaluationReportingPort } from "./ports/experiment-evaluation-reporting.port.ts";
export { ExperimentModelCostPort } from "./ports/experiment-model-cost.port.ts";
export {
  ExperimentRunProgressPort,
  type ExperimentRunProgressFailure,
  type ExperimentRunProgressState,
  type ExperimentRunProgressSummary,
} from "./ports/experiment-run-progress.port.ts";
export { ExperimentRunErrorReportingPort } from "./ports/experiment-run-error-reporting.port.ts";
export { ExperimentSandboxCredentialPort } from "./ports/experiment-sandbox-credential.port.ts";
export { ExperimentStudioDispatchPort } from "./ports/experiment-studio-dispatch.port.ts";
export { ExperimentTargetEntityNamesPort } from "./ports/experiment-target-entity-names.port.ts";
export { ExperimentWorkflowDslPort } from "./ports/experiment-workflow-dsl.port.ts";
export { RedisExperimentRunProgressAdapter } from "./adapters/redis.experiment-run-progress.adapter.ts";

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
  createExperimentV3LegacyAliasRestApp,
  createExperimentV3RestApp,
  type ExperimentV3RestCredential,
  type ExperimentV3RestPorts,
  type ExperimentV3RestSession,
  type ExperimentV3RunLoop,
  type ExperimentV3StartRunInput,
} from "./transport/api-rest/experiment-v3.api.ts";
export {
  ExperimentFindOrCreateService,
  type ExperimentFindOrCreateInput,
} from "./services/experiment-find-or-create.service.ts";
export {
  createExperimentInitRestApp,
  type ExperimentInitRestCredential,
  type ExperimentInitRestPorts,
} from "./transport/api-rest/experiment-init.api.ts";
export {
  createDspyStepsRestApp,
  type DspyStepsRestCredential,
  type DspyStepsRestPorts,
} from "./transport/api-rest/experiment-dspy-steps.api.ts";
