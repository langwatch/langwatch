import type {
  ElasticSearchSpan,
  Trace,
  TraceCheck,
} from "../server/tracer/types";

export type TraceCheckJob = {
  trace_id: string;
  project_id: string;
};

export type TraceCheckResult = {
  raw_result: object;
  value: number;
  status: "failed" | "succeeded";
};

export type TraceCheckBackendDefinition = {
  execute: (
    trace: Trace,
    _spans: ElasticSearchSpan[]
  ) => Promise<TraceCheckResult>;
};

export type TraceCheckFrontendDefinition = {
  name: string;
  render: (props: { check: TraceCheck }) => JSX.Element;
};

export type CheckTypes = "pii_check" | "toxicity_check";
export type ModerationResult = {
  id: string;
  model: string;
  results: ModerationResultEntry[];
};

export type ModerationResultEntry = {
  flagged: boolean;
  categories: Record<string, boolean>;
  category_scores: Record<string, number>;
};
