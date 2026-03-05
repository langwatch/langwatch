import type { EvaluatorTypes } from "../../server/evaluations/evaluators.generated";
import type {
  CustomMetadata,
  ElasticSearchTrace,
  RESTEvaluation,
  ReservedTraceMetadata,
  Span,
  TrackEventRESTParamsValidator,
} from "../tracer/types";

export type EvaluationJobCheck = {
  evaluation_id: string;
  evaluator_id: string;
  type: EvaluatorTypes;
  name: string;
  /** @deprecated Legacy field - use evaluation_id/evaluator_id instead. Kept for backwards compatibility with old queue jobs. */
  id?: string;
};

export type EvaluationJob = {
  check: EvaluationJobCheck;
  trace: {
    trace_id: string;
    project_id: string;
    thread_id?: string | undefined;
    user_id?: string | undefined;
    customer_id?: string | undefined;
    labels?: string[] | undefined;
  };
};

/**
 * Extracts the evaluation ID from a check object.
 * Handles both new format (evaluation_id) and legacy format (id).
 * @throws Error if no valid ID is found (surfaces data quality issues)
 */
export function getEvaluationId(check: EvaluationJobCheck): string {
  const id = check.evaluation_id ?? check.id;
  if (!id) {
    throw new Error(
      `Missing evaluation ID in check object: ${JSON.stringify(check)}`,
    );
  }
  return id;
}

/**
 * Extracts the evaluator ID from a check object.
 * Handles both new format (evaluator_id) and legacy format (id).
 * @throws Error if no valid ID is found (surfaces data quality issues)
 */
export function getEvaluatorId(check: EvaluationJobCheck): string {
  const id = check.evaluator_id ?? check.id;
  if (!id) {
    throw new Error(
      `Missing evaluator ID in check object: ${JSON.stringify(check)}`,
    );
  }
  return id;
}

export type TopicClusteringJob = {
  project_id: string;
  search_after?: [number, string];
};

export type TrackEventJob = {
  project_id: string;
  postpone_count: number;
  event: TrackEventRESTParamsValidator & {
    event_id: string;
    timestamp: number;
  };
};

export type CollectorJob = {
  spans: Span[];
  evaluations: RESTEvaluation[] | undefined;
  traceId: string;
  projectId: string;
  expectedOutput: string | null | undefined;
  reservedTraceMetadata: ReservedTraceMetadata;
  customMetadata: CustomMetadata;
  collectedAt: number;

  existingTrace?: {
    inserted_at?: number;
    indexing_md5s?: string[];
    existing_metadata?: ElasticSearchTrace["metadata"];
  };
  paramsMD5: string;
};

export type CollectorCheckAndAdjustJob = {
  action: "check_and_adjust";
  traceId: string;
  projectId: string;
};

export type UsageStatsJob = {
  instance_id: string;
  timestamp: number;
};

