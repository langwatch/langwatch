/**
 * What the `evaluations.*` door reaches that Evaluation does not own: this
 * install's environment, the project's workflow-backed evaluators, the one
 * evaluator runtime and its probe, the product signal, and the verdict pipeline.
 */
import type {
  CustomEvaluator,
  EvaluationRunOutcome,
  ReportEvaluationCommandData,
  RunTraceEvaluationInput,
} from "@langwatch/evaluation-contract";

/** The environment variables this install was started with. */
export abstract class EvaluationInstallEnvironmentPort {
  abstract read(): Readonly<Record<string, string | undefined>>;
}

/** The project's own workflow-backed evaluators, each with its published version. */
export abstract class EvaluationCustomEvaluatorsPort {
  abstract findAll(input: Readonly<{ projectId: string }>): Promise<CustomEvaluator[]>;
}

/** Scores one stored trace with one evaluator, resolving the caller's protections. */
export abstract class EvaluationRescorePort {
  abstract runForTrace(input: RunTraceEvaluationInput): Promise<EvaluationRunOutcome>;
}

/**
 * One liveness probe at the evaluator backend. A failed probe is not an error,
 * only a probe that did not warm anything.
 */
export abstract class EvaluationWarmupPort {
  abstract probe(input: Readonly<{ projectId: string }>): Promise<void>;
}

/** Product analytics for a completed run. */
export abstract class EvaluationRunAnalyticsPort {
  abstract evaluationRan(input: Readonly<{ userId: string; projectId: string }>): void;
}

/** The verdict command every reported evaluation travels on. */
export abstract class EvaluationReportPort {
  abstract reportEvaluation(data: ReportEvaluationCommandData): Promise<unknown>;
}
