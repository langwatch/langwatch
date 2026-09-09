import { moduleApi } from "@langwatch/runtime-composition";
import type { DSPyRunsSummary } from "./experiment-legacy.ts";
import type {
  Experiment,
  ExperimentLookup,
  ExperimentPage,
  ExperimentPageInput,
  ExperimentSlugLookup,
  ExperimentType,
  FindOrCreateWorkflowExperimentInput,
  SaveExperimentInput,
} from "./experiment.ts";
import type {
  CompleteExperimentRunInput,
  ExperimentRun,
  ExperimentRunAggregate,
  ExperimentRunListInput,
  ExperimentRunLookup,
  ExperimentRunPageInput,
  ExperimentRunSlugPageInput,
  ExperimentRunWithItems,
  RecordEvaluatorResultInput,
  RecordTargetResultInput,
  StartExperimentRunInput,
} from "./experiment-run.ts";
import type {
  ExperimentDspyStep,
  ExperimentDspyStepLookup,
  ExperimentDspyStepSummary,
  ExperimentDspyStepsLookup,
} from "./experiment-dspy.ts";
import type {
  GetWorkbenchStateInput,
  ListWorkbenchVersionsInput,
  RecordWorkbenchRunResultsInput,
  WorkbenchSaveResult,
  WorkbenchStateView,
  WorkbenchVersionsPage,
} from "./experiment-workbench-version.ts";

/**
 * Callable capability exposed by the composed Experiment application.
 *
 * This is the former `ExperimentService` contract-service, folded in here per
 * ADR-133: a contract package names only its callable API, never a standalone
 * abstract service class. Four workbench writes stay App-only
 * (`saveWorkbenchState`, `createEvaluationsV3`, `commitWorkbenchVersion`,
 * `restoreWorkbenchVersion`) because the App reshapes their input to take the
 * caller as a separate argument rather than an `actor` field; that reshaping
 * is server-private, not part of the portable token.
 */
export interface ExperimentApi {
  getById(input: ExperimentLookup): Promise<Experiment>;
  getBySlug(input: ExperimentSlugLookup): Promise<Experiment>;
  getBySlugOrId(input: { projectId: string; slugOrId: string }): Promise<Experiment>;
  tryGetById(input: ExperimentLookup): Promise<Experiment | null>;
  tryGetBySlug(input: ExperimentSlugLookup): Promise<Experiment | null>;
  tryGetBySlugAndType(
    input: ExperimentSlugLookup & { type: ExperimentType },
  ): Promise<Experiment | null>;
  list(input: { projectId: string }): Promise<Experiment[]>;
  getPage(input: ExperimentPageInput): Promise<ExperimentPage>;
  tryGetLatest(input: { projectId: string }): Promise<Experiment | null>;
  tryGetIdBySlug(input: ExperimentSlugLookup): Promise<{ id: string; slug: string } | null>;
  isActive(input: ExperimentLookup): Promise<boolean>;
  save(input: SaveExperimentInput): Promise<Experiment>;
  findOrCreateForWorkflow(
    input: FindOrCreateWorkflowExperimentInput,
  ): Promise<{ id: string; slug: string }>;
  findNextDraftName(input: { projectId: string }): Promise<string>;
  archive(input: ExperimentLookup): Promise<{ success: true }>;
  listRuns(input: ExperimentRunListInput): Promise<Record<string, ExperimentRun[]>>;
  getRunAggregates(input: ExperimentRunListInput): Promise<Record<string, ExperimentRunAggregate>>;
  getRunsPage(input: ExperimentRunPageInput): Promise<{ runs: ExperimentRun[]; totalHits: number }>;
  /** A polling read: absent rows and disabled ClickHouse both read as null. */
  tryGetRun(input: ExperimentRunLookup): Promise<ExperimentRunWithItems | null>;
  getRunsPageBySlug(input: ExperimentRunSlugPageInput): Promise<{
    experiment: { id: string; slug: string };
    runs: ExperimentRun[];
    totalHits: number;
  }>;
  startExperimentRun(input: StartExperimentRunInput): Promise<void>;
  recordTargetResult(input: RecordTargetResultInput): Promise<void>;
  recordEvaluatorResult(input: RecordEvaluatorResultInput): Promise<void>;
  completeExperimentRun(input: CompleteExperimentRunInput): Promise<void>;
  upsertDspyStep(input: ExperimentDspyStep): Promise<void>;
  listDspySteps(input: ExperimentDspyStepsLookup): Promise<ExperimentDspyStepSummary[]>;
  listDspyRuns(input: ExperimentDspyStepsLookup): Promise<DSPyRunsSummary[]>;
  getDspyStep(input: ExperimentDspyStepLookup): Promise<ExperimentDspyStep>;
  getWorkbenchState(input: GetWorkbenchStateInput): Promise<WorkbenchStateView>;
  listWorkbenchVersions(input: ListWorkbenchVersionsInput): Promise<WorkbenchVersionsPage>;
  recordWorkbenchRunResults(input: RecordWorkbenchRunResultsInput): Promise<WorkbenchSaveResult>;
}

export const ExperimentApi = moduleApi<ExperimentApi>("experiment");
