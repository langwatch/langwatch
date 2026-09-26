import {
  TraceContentReadService as TraceContentReadContract,
  type Span,
  type Trace,
  type TraceLegacyListInput,
  type TracesForProjectResult,
} from "@langwatch/trace-contract";

import type { TraceLegacyRead } from "../app/trace.members.ts";

export class TraceContentReadService extends TraceContentReadContract {
  static create(read: TraceLegacyRead): TraceContentReadService {
    return new TraceContentReadService(read);
  }

  private constructor(private readonly read: TraceLegacyRead) {
    super();
  }

  listTraces(input: {
    query: TraceLegacyListInput;
    protections: unknown;
    options?: {
      downloadMode?: boolean;
      includeSpans?: boolean;
      resolveBlobs?: boolean;
      scrollId?: string | null;
    };
  }): Promise<TracesForProjectResult> {
    return this.read.getAllTracesForProject(input.query, input.protections, input.options);
  }

  findTrace(input: {
    projectId: string;
    traceId: string;
    protections: unknown;
    withEditOverlay?: boolean;
  }): Promise<Trace | undefined> {
    return this.read.findById({
      projectId: input.projectId,
      traceId: input.traceId,
      protections: input.protections,
      opts: {
        full: true,
        ...(input.withEditOverlay !== undefined ? { withEditOverlay: input.withEditOverlay } : {}),
      },
    });
  }

  readTracesWithSpans(input: {
    projectId: string;
    traceIds: string[];
    protections: unknown;
    occurredAt?: { from: number; to: number };
    withEditOverlay?: boolean;
  }): Promise<Trace[]> {
    return this.read.getTracesWithSpans({
      projectId: input.projectId,
      traceIds: input.traceIds,
      protections: input.protections,
      occurredAt: input.occurredAt,
      opts: {
        full: true,
        ...(input.withEditOverlay !== undefined ? { withEditOverlay: input.withEditOverlay } : {}),
      },
    });
  }

  readTracesWithSpansPreview(input: {
    projectId: string;
    traceIds: string[];
    protections: unknown;
    withEditOverlay?: boolean;
  }): Promise<Trace[]> {
    return this.read.getTracesWithSpans({
      projectId: input.projectId,
      traceIds: input.traceIds,
      protections: input.protections,
      occurredAt: void 0,
      opts: input.withEditOverlay !== undefined ? { withEditOverlay: input.withEditOverlay } : {},
    });
  }

  async readOrderedSpansForTrace(input: {
    projectId: string;
    traceId: string;
    protections: unknown;
  }): Promise<Span[]> {
    const traces = await this.readTracesWithSpans({ ...input, traceIds: [input.traceId] });
    const trace = traces.find((candidate) => candidate.trace_id === input.traceId);
    if (!trace?.spans) return [];
    return trace.spans.toSorted((a, b) => {
      const start = (a.timestamps?.started_at ?? 0) - (b.timestamps?.started_at ?? 0);
      return start === 0
        ? (b.timestamps?.finished_at ?? 0) - (a.timestamps?.finished_at ?? 0)
        : start;
    });
  }

  readThreadTraces(input: {
    projectId: string;
    threadId: string;
    protections: unknown;
  }): Promise<Trace[]> {
    return this.read.getTracesByThreadId({
      projectId: input.projectId,
      threadId: input.threadId,
      protections: input.protections,
      opts: {
        full: true,
      },
    });
  }

  readThreadsTraces(input: {
    projectId: string;
    threadIds: string[];
    protections: unknown;
    withEditOverlay?: boolean;
    maxTraces?: number;
  }): Promise<Trace[]> {
    return this.read.getTracesWithSpansByThreadIds({
      projectId: input.projectId,
      threadIds: input.threadIds,
      protections: input.protections,
      opts: {
        full: true,
        ...(input.withEditOverlay !== undefined ? { withEditOverlay: input.withEditOverlay } : {}),
        ...(input.maxTraces !== undefined ? { maxTraces: input.maxTraces } : {}),
      },
    });
  }

  async readSampleTraces(input: {
    query: TraceLegacyListInput;
    protections: unknown;
    pageSize: number;
  }): Promise<Trace[]> {
    const { groups } = await this.listTraces({
      query: { ...input.query, groupBy: "none", pageSize: input.pageSize },
      protections: input.protections,
    });
    const traceIds = groups.flatMap((group) => group.map((trace) => trace.trace_id));
    return traceIds.length === 0
      ? []
      : this.readTracesWithSpans({
          projectId: input.query.projectId,
          traceIds,
          protections: input.protections,
          occurredAt: { from: input.query.startDate, to: input.query.endDate },
        });
  }
}
