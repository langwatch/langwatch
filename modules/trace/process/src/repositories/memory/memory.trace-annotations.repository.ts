import type { FoldStateRead, ProjectionStoreContext } from "@langwatch/eventing";

import {
  type TraceAnnotationContent,
  type TraceAnnotationFoldState,
  type TraceAnnotationRow,
  TraceAnnotationsReadRepository,
  type TraceAnnotationsRepository,
} from "../trace-annotations.repository.ts";

function isLiveAnnotation(
  state: TraceAnnotationFoldState,
): state is TraceAnnotationFoldState & { content: TraceAnnotationContent } {
  return !state.deleted && state.content !== null;
}

/** Trace's folded annotations in memory: the latest state per tenant and annotation. */
export class MemoryTraceAnnotationsRepository
  extends TraceAnnotationsReadRepository
  implements TraceAnnotationsRepository
{
  static create(): MemoryTraceAnnotationsRepository {
    return new MemoryTraceAnnotationsRepository();
  }

  private readonly rows = new Map<string, TraceAnnotationFoldState>();

  private constructor() {
    super();
  }

  async get(
    aggregateId: string,
    context: ProjectionStoreContext,
  ): Promise<FoldStateRead<TraceAnnotationFoldState>> {
    const state = this.rows.get(`${context.tenantId}/${aggregateId}`);
    return state ? { kind: "folded", state } : { kind: "empty" };
  }

  async store(state: TraceAnnotationFoldState, context: ProjectionStoreContext): Promise<void> {
    this.rows.set(`${context.tenantId}/${state.annotationId || context.aggregateId}`, state);
  }

  async findForTraces({
    projectId,
    traceIds,
  }: {
    projectId: string;
    traceIds: string[];
  }): Promise<TraceAnnotationRow[]> {
    const wanted = new Set(traceIds);
    return [...this.rows.entries()]
      .filter(([key]) => key.startsWith(`${projectId}/`))
      .map(([, state]) => state)
      .filter(isLiveAnnotation)
      .filter((state) => wanted.has(state.traceId))
      .map((state) => ({ ...state.content, id: state.annotationId, traceId: state.traceId }))
      .toSorted((a, b) => a.createdAt - b.createdAt);
  }
}
