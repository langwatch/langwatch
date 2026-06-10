import type { Protections } from "~/server/elasticsearch/protections";
import type { TraceEvaluation } from "./evaluation-run.types";

/**
 * Repository interface for evaluation reads.
 *
 * Implementations exist for ClickHouse and Elasticsearch.
 * The EvaluationService facade picks the right one based on feature flags.
 */
export interface EvaluationRepository {
  getEvaluationsForTrace(params: {
    projectId: string;
    traceId: string;
    protections?: Protections;
  }): Promise<TraceEvaluation[]>;

  getEvaluationsMultiple(params: {
    projectId: string;
    traceIds: string[];
    protections?: Protections;
  }): Promise<Record<string, TraceEvaluation[]>>;

  /**
   * Fetch the heavy `inputs` blob for a single evaluation, on demand. Kept
   * off the list reads so the trace-wide query stays light; loaded lazily
   * when a single evaluation is expanded. Returns null when the backend has
   * no inputs to offer.
   */
  getEvaluationInputs(params: {
    projectId: string;
    evaluationId: string;
    protections?: Protections;
  }): Promise<Record<string, unknown> | null>;
}
