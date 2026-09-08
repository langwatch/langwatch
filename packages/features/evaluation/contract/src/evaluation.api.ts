import { featureApi } from "@langwatch/runtime-composition";
import type {
  ExecuteEvaluationCommand,
  UpsertEvaluationRunCommand,
} from "./evaluation.commands.ts";
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
  tryGetRunByEvaluationId(input: EvaluationRunLookup): Promise<EvaluationRunData | null>;
  findRunsByTraceId(input: EvaluationRunsByTraceQuery): Promise<EvaluationRunData[]>;
  findSummariesByTraceIds(
    input: EvaluationSummariesByTraceIdsQuery,
  ): Promise<Record<string, EvaluationSummary[]>>;
  findTraceEvaluations(
    input: TraceEvaluationsQuery,
  ): Promise<Record<string, TraceEvaluationData[]>>;
  tryGetInputs(input: EvaluationInputsQuery): Promise<Record<string, unknown> | null>;
  getMonitorPerformance(input: MonitorPerformanceQuery): Promise<OnlineEvaluationPerformance[]>;
}

export const EvaluationApi = featureApi<EvaluationApi>("evaluation");
