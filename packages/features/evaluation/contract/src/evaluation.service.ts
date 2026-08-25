import type {
  ExecuteEvaluationCommand,
  UpsertEvaluationRunCommand,
} from "./evaluation.commands";
import type {
  EvaluationExecutionResult,
  EvaluationRunData,
  EvaluationSummary,
  TraceEvaluationData,
} from "./evaluation";
import type {
  MonitorPerformanceQuery,
  OnlineEvaluationPerformance,
} from "./evaluation.performance";
import type {
  EvaluationInputsQuery,
  EvaluationRunLookup,
  EvaluationRunsByTraceQuery,
  EvaluationSummariesByTraceIdsQuery,
  TraceEvaluationsQuery,
} from "./evaluation.queries";

export abstract class EvaluationService {
  abstract executeForTrace(
    input: ExecuteEvaluationCommand,
  ): Promise<EvaluationExecutionResult>;
  abstract upsertRun(input: UpsertEvaluationRunCommand): Promise<void>;
  abstract upsertRuns(input: UpsertEvaluationRunCommand[]): Promise<void>;
  abstract getRunByEvaluationId(input: EvaluationRunLookup): Promise<EvaluationRunData>;
  abstract tryGetRunByEvaluationId(
    input: EvaluationRunLookup,
  ): Promise<EvaluationRunData | null>;
  abstract findRunsByTraceId(
    input: EvaluationRunsByTraceQuery,
  ): Promise<EvaluationRunData[]>;
  abstract findSummariesByTraceIds(
    input: EvaluationSummariesByTraceIdsQuery,
  ): Promise<Record<string, EvaluationSummary[]>>;
  abstract findTraceEvaluations(
    input: TraceEvaluationsQuery,
  ): Promise<Record<string, TraceEvaluationData[]>>;
  abstract tryGetInputs(
    input: EvaluationInputsQuery,
  ): Promise<Record<string, unknown> | null>;
  abstract getMonitorPerformance(
    input: MonitorPerformanceQuery,
  ): Promise<OnlineEvaluationPerformance[]>;
}
