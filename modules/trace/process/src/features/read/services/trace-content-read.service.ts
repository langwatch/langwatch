import type { Authorization } from "@langwatch/authorization";
import type {
  Span,
  Trace,
  TraceLegacyListInput,
  TraceSummaryListOptions,
  TraceSummaryListQuery,
  TraceSummaryPage,
  TracesForProjectResult,
} from "@langwatch/trace-contract";

import type { TraceLegacyRead } from "../../../services/trace-viewer.service.ts";

/** The content reads over the legacy read; every store read carries the caller's own-only proof. */
export class TraceContentReadService {
  static create(read: TraceLegacyRead): TraceContentReadService {
    return new TraceContentReadService(read);
  }

  private constructor(private readonly read: TraceLegacyRead) {}

  listTraces(input: {
    /** The own-only proof every store read goes through (ruling TRACE-PROOF-SHARE). */
    authorization: Authorization;
    query: TraceLegacyListInput;
    protections: unknown;
    options?: {
      downloadMode?: boolean;
      includeSpans?: boolean;
      resolveBlobs?: boolean;
      scrollId?: string | null;
    };
  }): Promise<TracesForProjectResult> {
    return this.read.getAllTracesForProject(input.query, input.protections, {
      ...input.options,
      ownRead: input.authorization,
    });
  }

  listTraceSummaries(input: {
    query: TraceSummaryListQuery;
    options?: TraceSummaryListOptions;
  }): Promise<TraceSummaryPage> {
    return this.read.listTraceSummaries(input.query, input.options);
  }

  findTrace(input: {
    /** The own-only proof every store read goes through (ruling TRACE-PROOF-SHARE). */
    authorization: Authorization;
    projectId: string;
    traceId: string;
    protections: unknown;
    withEditOverlay?: boolean;
  }): Promise<Trace | undefined> {
    return this.read.findById({
      authorization: input.authorization,
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
    /** The own-only proof every store read goes through (ruling TRACE-PROOF-SHARE). */
    authorization: Authorization;
    projectId: string;
    traceIds: string[];
    protections: unknown;
    occurredAt?: { from: number; to: number };
    withEditOverlay?: boolean;
  }): Promise<Trace[]> {
    return this.read.getTracesWithSpans({
      authorization: input.authorization,
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
    /** The own-only proof every store read goes through (ruling TRACE-PROOF-SHARE). */
    authorization: Authorization;
    projectId: string;
    traceIds: string[];
    protections: unknown;
    withEditOverlay?: boolean;
  }): Promise<Trace[]> {
    return this.read.getTracesWithSpans({
      authorization: input.authorization,
      projectId: input.projectId,
      traceIds: input.traceIds,
      protections: input.protections,
      occurredAt: void 0,
      opts: input.withEditOverlay !== undefined ? { withEditOverlay: input.withEditOverlay } : {},
    });
  }

  async readOrderedSpansForTrace(input: {
    /** The own-only proof every store read goes through (ruling TRACE-PROOF-SHARE). */
    authorization: Authorization;
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
    /** The own-only proof every store read goes through (ruling TRACE-PROOF-SHARE). */
    authorization: Authorization;
    projectId: string;
    threadId: string;
    protections: unknown;
  }): Promise<Trace[]> {
    return this.read.getTracesByThreadId({
      authorization: input.authorization,
      projectId: input.projectId,
      threadId: input.threadId,
      protections: input.protections,
      opts: {
        full: true,
      },
    });
  }

  readThreadsTraces(input: {
    /** The own-only proof every store read goes through (ruling TRACE-PROOF-SHARE). */
    authorization: Authorization;
    projectId: string;
    threadIds: string[];
    protections: unknown;
    withEditOverlay?: boolean;
    maxTraces?: number;
  }): Promise<Trace[]> {
    return this.read.getTracesWithSpansByThreadIds({
      authorization: input.authorization,
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
    /** The own-only proof every store read goes through (ruling TRACE-PROOF-SHARE). */
    authorization: Authorization;
    query: TraceLegacyListInput;
    protections: unknown;
    pageSize: number;
  }): Promise<Trace[]> {
    const { groups } = await this.listTraces({
      query: { ...input.query, groupBy: "none", pageSize: input.pageSize },
      protections: input.protections,
      authorization: input.authorization,
    });
    const traceIds = groups.flatMap((group) => group.map((trace) => trace.trace_id));
    return traceIds.length === 0
      ? []
      : this.readTracesWithSpans({
          projectId: input.query.projectId,
          traceIds,
          protections: input.protections,
          authorization: input.authorization,
          occurredAt: { from: input.query.startDate, to: input.query.endDate },
        });
  }
}
