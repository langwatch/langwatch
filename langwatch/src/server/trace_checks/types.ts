import type { ElasticSearchSpan, Trace } from "../tracer/types";

export type TraceCheckJob = {
  trace_id: string;
  project_id: string;
};

export type TraceCheckResult = {
  raw_result: object;
  value: number;
};

export type TraceCheckDefinition = {
  execute: (
    trace: Trace,
    _spans: ElasticSearchSpan[]
  ) => Promise<TraceCheckResult>;
};

export type CheckTypes = "pii_check";
