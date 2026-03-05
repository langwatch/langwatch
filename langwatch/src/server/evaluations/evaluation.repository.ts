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
}
