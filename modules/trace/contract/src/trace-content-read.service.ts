import type {
  TraceLegacyFilterInput,
  TraceLegacyListInput,
  TracesForProjectResult,
} from "./trace-read.contract.ts";
import type { Span } from "./trace-format.schemas.ts";
import type { Trace } from "./trace-format.schemas.ts";

export abstract class TraceContentReadService {
  abstract listTraces(input: {
    query: TraceLegacyListInput;
    protections: unknown;
    options?: {
      downloadMode?: boolean;
      includeSpans?: boolean;
      resolveBlobs?: boolean;
      scrollId?: string | null;
    };
  }): Promise<TracesForProjectResult>;
  abstract readTrace(input: {
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
  abstract readThreadsTraces(input: {
    projectId: string;
    threadIds: string[];
    protections: unknown;
    withEditOverlay?: boolean;
  }): Promise<Trace[]>;
  abstract readSampleTraces(input: {
    query: TraceLegacyListInput;
    protections: unknown;
    pageSize: number;
  }): Promise<Trace[]>;
}
