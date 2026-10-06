/**
 * The persistence-and-orchestration service, folded out of the contract
 * package (ADR-133: no standalone contract-service class). Peer compositions
 * still import the full surface's type from here.
 */
export type { ExperimentServiceOptions } from "./services/experiment.service.ts";
export type {
  ClickhouseExperimentRunProcessingRepository,
  ExperimentRunProcessingPipeline,
} from "./eventing/experiment-run-processing.pipeline.ts";
export type { ExperimentAppDependencies } from "./app/experiment.app.ts";
export { experimentProcessModule } from "./experiment.module.ts";
export { experimentTrpcTransport } from "./transport/experiment.trpc.ts";
export { experimentRest, experimentRestCredential } from "./transport/experiment.rest.ts";

export {
  buildStripScoreEvaluatorIds,
  shouldStripScore,
} from "./eventing/experiment-evaluator-score-filter.process.ts";

export type { ExperimentRunProgressState } from "./repositories/experiment-run-fold.repository.ts";

export type { ExperimentRunCollaborators } from "./rules/experiment-run-input.rules.ts";
export type {
  RunResultsPersistence,
  RunResultsWriter,
} from "./services/experiment-run-results-writer.service.ts";
export type { SavedStateExecution } from "./services/experiment-saved-state-execution.service.ts";
export type {
  ExecutionDataInputs,
  ExecutionDataServices,
  LoadedExecutionData,
  LoadedWorkflow,
} from "./services/experiment-execution-data.service.ts";
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
export type { ExperimentWorkbenchObserver } from "./services/experiment-workbench-observer.service.ts";
export { experimentWorkbenchRunRest } from "./transport/experiment-workbench-run.rest.ts";
export type { ExperimentFindOrCreateInput } from "./services/experiment-find-or-create.service.ts";
export { experimentInitRest } from "./transport/experiment-init.rest.ts";
export { experimentDspyStepsRest } from "./transport/experiment-dspy-steps.rest.ts";
