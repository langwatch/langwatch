import type { SingleEvaluationResult } from "@langwatch/evaluator-contract";
import { moduleApi } from "@langwatch/runtime-composition";
import type {
  ExecuteEvaluationCommand,
  UpsertEvaluationRunCommand,
} from "./evaluation.commands.ts";
import type { ReportEvaluationCommandData } from "./evaluation-event.commands.ts";
import type {
  DatasetEvaluationRow,
  EvaluationCostRecord,
  EvaluationModelLookup,
  EvaluationMonitorSummary,
  EvaluationSlugLookup,
  EvaluationSlugMatch,
  LogBatchEvaluationInput,
  RunEvaluatorInput,
  SavedEvaluatorLookup,
  SavedEvaluatorResolution,
} from "./evaluation-rest.schemas.ts";
import type {
  EvaluationExecutionResult,
  EvaluationRunData,
  EvaluationSummary,
  TraceEvaluationData,
} from "./evaluation.ts";
import type {
  MonitorPerformanceQuery,
  OnlineEvaluationPerformance,
} from "./evaluation.performance.ts";
import type {
  EvaluationInputsQuery,
  EvaluationRunLookup,
  EvaluationRunsByTraceQuery,
  EvaluationSummariesByTraceIdsQuery,
  TraceEvaluationsQuery,
} from "./evaluation.queries.ts";
import type {
  CustomEvaluator,
  EvaluationProjectScope,
  RunTraceEvaluationInput,
  WarmupEvaluatorsInput,
} from "./evaluation-trpc.schemas.ts";
import type {
  EvaluationRunOutcome,
  EvaluationWarmup,
  EvaluatorCatalogue,
} from "./evaluation.responses.ts";

/** The complete callable Evaluation capability shared by process peers. */
export interface EvaluationApi {
  /** Every evaluator, with what this install and this project are missing for it. */
  listEvaluators(input: EvaluationProjectScope): Promise<EvaluatorCatalogue>;
  /** The project's own workflow-backed evaluators. */
  listCustomEvaluators(input: EvaluationProjectScope): Promise<CustomEvaluator[]>;
  /** Scores one stored trace now, and reports the verdict onto the pipeline. */
  runTraceEvaluation(
    input: RunTraceEvaluationInput,
    by: Readonly<{ id: string }>,
  ): Promise<EvaluationRunOutcome>;
  /** Nudges the evaluator runtime ahead of a run. */
  warmupEvaluators(input: WarmupEvaluatorsInput): Promise<EvaluationWarmup>;
  executeForTrace(input: ExecuteEvaluationCommand): Promise<EvaluationExecutionResult>;
  upsertRun(input: UpsertEvaluationRunCommand): Promise<void>;
  upsertRuns(input: UpsertEvaluationRunCommand[]): Promise<void>;
  getRunByEvaluationId(input: EvaluationRunLookup): Promise<EvaluationRunData>;
  findRunByEvaluationId(input: EvaluationRunLookup): Promise<EvaluationRunData | null>;
  findRunsByTraceId(input: EvaluationRunsByTraceQuery): Promise<EvaluationRunData[]>;
  findSummariesByTraceIds(
    input: EvaluationSummariesByTraceIdsQuery,
  ): Promise<Record<string, EvaluationSummary[]>>;
  findTraceEvaluations(
    input: TraceEvaluationsQuery,
  ): Promise<Record<string, TraceEvaluationData[]>>;
  findInputs(input: EvaluationInputsQuery): Promise<Record<string, unknown> | null>;
  getMonitorPerformance(input: MonitorPerformanceQuery): Promise<OnlineEvaluationPerformance[]>;

  // The public evaluation doors: the SDK's batch result log and the four
  // evaluate paths reach the same capability every other caller does.

  /** Records one SDK batch evaluation: its run, its rows and its verdicts. */
  logBatchEvaluation(input: LogBatchEvaluationInput): Promise<void>;
  /** Runs one evaluator over one input, and never rejects for a domain reason. */
  runEvaluator(input: RunEvaluatorInput): Promise<SingleEvaluationResult>;
  /** One saved evaluator, ready to run; throws when no evaluator answers to it. */
  resolveSavedEvaluator(input: SavedEvaluatorLookup): Promise<SavedEvaluatorResolution>;
  /** One monitor by slug, or null. */
  findMonitorBySlug(input: EvaluationSlugLookup): Promise<EvaluationMonitorSummary | null>;
  /** One dataset by slug, or null. */
  findDatasetBySlug(input: EvaluationSlugLookup): Promise<EvaluationSlugMatch | null>;
  /** One experiment by slug, or null. */
  findExperimentBySlug(input: EvaluationSlugLookup): Promise<EvaluationSlugMatch | null>;
  /** The model the project's cascade resolves for one feature key, or null. */
  findModelForFeature(input: EvaluationModelLookup): Promise<string | null>;
  /** Records what a run of an evaluator cost. */
  recordEvaluationCost(input: EvaluationCostRecord): Promise<EvaluationSlugMatch>;
  /** Records one row of a dataset evaluation. */
  recordDatasetEvaluationRow(input: DatasetEvaluationRow): Promise<void>;
  /** Reports one verdict onto the evaluation processing pipeline. */
  reportEvaluation(data: ReportEvaluationCommandData): Promise<void>;
  /** The evaluator-id slug rule for an evaluation that names no evaluator. */
  deriveEvaluatorId(name: string): string;
}

export const EvaluationApi = moduleApi<EvaluationApi>("evaluation");
