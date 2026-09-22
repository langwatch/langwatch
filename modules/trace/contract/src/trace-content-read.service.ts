import type { Span, Trace } from "./trace-format.schemas.ts";
import type { TraceDateField } from "./trace-legacy-read.types.ts";
import type { CompiledProjection } from "./trace-projection.types.ts";
import type { TraceLegacyListInput, TracesForProjectResult } from "./trace-read.contract.ts";

export abstract class TraceContentReadService {
  abstract listTraces(input: {
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
    };
  }): Promise<TracesForProjectResult>;
  abstract findTrace(input: {
    projectId: string;
    traceId: string;
    protections: unknown;
    withEditOverlay?: boolean;
  }): Promise<Trace | undefined>;
  abstract readTracesWithSpans(input: {
    projectId: string;
    traceIds: string[];
    protections: unknown;
    occurredAt?: { from: number; to: number };
    withEditOverlay?: boolean;
  }): Promise<Trace[]>;
  abstract readTracesWithSpansPreview(input: {
    projectId: string;
    traceIds: string[];
    protections: unknown;
    withEditOverlay?: boolean;
  }): Promise<Trace[]>;
  abstract readOrderedSpansForTrace(input: {
    projectId: string;
    traceId: string;
    protections: unknown;
  }): Promise<Span[]>;
  abstract readThreadTraces(input: {
    projectId: string;
    threadId: string;
    protections: unknown;
  }): Promise<Trace[]>;
  /** `maxTraces` is the ceiling across every thread asked for, not per thread. */
  abstract readThreadsTraces(input: {
    projectId: string;
    threadIds: string[];
    protections: unknown;
    withEditOverlay?: boolean;
    maxTraces?: number;
  }): Promise<Trace[]>;
  abstract readSampleTraces(input: {
    query: TraceLegacyListInput;
    protections: unknown;
    pageSize: number;
  }): Promise<Trace[]>;
}
