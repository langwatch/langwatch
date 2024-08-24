import type { EvaluatorTypes } from "../../trace_checks/evaluators.generated";
import type {
  CustomMetadata,
  ElasticSearchTrace,
  ReservedTraceMetadata,
  RESTEvaluation,
  Span,
  TrackEventRESTParamsValidator,
} from "../tracer/types";

export type TraceCheckJob = {
  check: {
    evaluation_id: string;
    evaluator_id: string;
    type: EvaluatorTypes;
    name: string;
  };
  trace: {
    trace_id: string;
    project_id: string;
    thread_id?: string | undefined;
    user_id?: string | undefined;
    customer_id?: string | undefined;
    labels?: string[] | undefined;
  };
};

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

  existingTrace?: {
    inserted_at?: number;
    indexing_md5s?: string[];
    existing_metadata?: ElasticSearchTrace["metadata"];
  };
  paramsMD5: string;
};
