import type { FoldStateRead, ProjectionStoreContext } from "@langwatch/eventing";

import {
  type TraceAnnotationScoreFoldState,
  TraceAnnotationScoresReadRepository,
  type TraceAnnotationScoresRepository,
} from "../trace-annotation-scores.repository.ts";

/** Trace's folded score names in memory: the latest state per tenant and score. */
export class MemoryTraceAnnotationScoresRepository
  extends TraceAnnotationScoresReadRepository
  implements TraceAnnotationScoresRepository
{
  static create(): MemoryTraceAnnotationScoresRepository {
    return new MemoryTraceAnnotationScoresRepository();
  }

  private readonly rows = new Map<string, TraceAnnotationScoreFoldState>();

  private constructor() {
    super();
  }

  async get(
    aggregateId: string,
    context: ProjectionStoreContext,
  ): Promise<FoldStateRead<TraceAnnotationScoreFoldState>> {
    const state = this.rows.get(`${context.tenantId}/${aggregateId}`);
    return state ? { kind: "folded", state } : { kind: "empty" };
  }

  async store(
    state: TraceAnnotationScoreFoldState,
    context: ProjectionStoreContext,
  ): Promise<void> {
    this.rows.set(`${context.tenantId}/${state.scoreId || context.aggregateId}`, state);
  }

  async findScoreNames({
    projectId,
  }: {
    projectId: string;
  }): Promise<{ id: string; name: string }[]> {
    return [...this.rows.entries()]
      .filter(([key]) => key.startsWith(`${projectId}/`))
      .flatMap(([, state]) =>
        state.name === null ? [] : [{ id: state.scoreId, name: state.name }],
      );
  }
}
