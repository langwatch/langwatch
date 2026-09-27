import type { Span, Trace } from "./trace-format.schemas.ts";
import type { TraceDateField } from "./trace-legacy-read.types.ts";
import type { CompiledProjection } from "./trace-projection.types.ts";
import type { TraceLegacyListInput, TracesForProjectResult } from "./trace-read.contract.ts";

export type TraceListTracesInput = {
  query: TraceLegacyListInput;
  protections: unknown;
  options?: {
    downloadMode?: boolean;
    includeSpans?: boolean;
    resolveBlobs?: boolean;
    scrollId?: string | null;
    /** Which timestamp `startDate`/`endDate` filters on; the v1 REST search's own axis choice. */
    dateField?: TraceDateField;
    /** A compiled `select` projection, applied by the read rather than reshaped after it. */
    projection?: CompiledProjection["plan"];
    /** The v1 REST search's compiled query-language filter, ANDed into the read. */
    filterWhere?: { sql: string; params: Record<string, unknown> };
  };
};

export type TraceFindTraceInput = {
  projectId: string;
  traceId: string;
  protections: unknown;
  withEditOverlay?: boolean;
};

export type TraceReadTracesWithSpansInput = {
  projectId: string;
  traceIds: string[];
  protections: unknown;
  occurredAt?: { from: number; to: number };
  withEditOverlay?: boolean;
};

export type TraceReadTracesWithSpansPreviewInput = {
  projectId: string;
  traceIds: string[];
  protections: unknown;
  withEditOverlay?: boolean;
};

export type TraceReadOrderedSpansInput = {
  projectId: string;
  traceId: string;
  protections: unknown;
};

export type TraceReadThreadTracesInput = {
  projectId: string;
  threadId: string;
  protections: unknown;
};

export type TraceReadThreadsTracesInput = {
  projectId: string;
  threadIds: string[];
  protections: unknown;
  withEditOverlay?: boolean;
  maxTraces?: number;
};

export type TraceReadSampleTracesInput = {
  query: TraceLegacyListInput;
  protections: unknown;
  pageSize: number;
};

export abstract class TraceContentReadService {
  abstract listTraces(input: TraceListTracesInput): Promise<TracesForProjectResult>;
  abstract findTrace(input: TraceFindTraceInput): Promise<Trace | undefined>;
  abstract readTracesWithSpans(input: TraceReadTracesWithSpansInput): Promise<Trace[]>;
  abstract readTracesWithSpansPreview(
    input: TraceReadTracesWithSpansPreviewInput,
  ): Promise<Trace[]>;
  abstract readOrderedSpansForTrace(input: TraceReadOrderedSpansInput): Promise<Span[]>;
  abstract readThreadTraces(input: TraceReadThreadTracesInput): Promise<Trace[]>;
  /** `maxTraces` is the ceiling across every thread asked for, not per thread. */
  abstract readThreadsTraces(input: TraceReadThreadsTracesInput): Promise<Trace[]>;
  abstract readSampleTraces(input: TraceReadSampleTracesInput): Promise<Trace[]>;
}
