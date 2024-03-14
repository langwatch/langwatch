import type { EvaluatorTypes } from "../../trace_checks/evaluators.generated";
import type { TrackEventRESTParamsValidator } from "../tracer/types";

export type TraceCheckJob = {
  check: {
    id: string;
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
