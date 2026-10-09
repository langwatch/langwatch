import type { ProjectionAnnotation } from "@langwatch/annotation-contract";

import { TraceAnnotationsReadRepository } from "../trace-annotations.repository.ts";

/** An annotation as a test seeds it, with the project that owns it. */
type SeededAnnotation = ProjectionAnnotation & { projectId: string };

/** Annotation's shared `Annotation` rows in memory, seeded by a test; trace writes none. */
export class MemoryTraceAnnotationsRepository extends TraceAnnotationsReadRepository {
  static create({
    annotations = [],
  }: { annotations?: readonly SeededAnnotation[] } = {}): MemoryTraceAnnotationsRepository {
    return new MemoryTraceAnnotationsRepository(annotations);
  }

  private constructor(private readonly annotations: readonly SeededAnnotation[]) {
    super();
  }

  async findForTraces({
    projectId,
    traceIds,
  }: {
    projectId: string;
    traceIds: string[];
  }): Promise<ProjectionAnnotation[]> {
    const wanted = new Set(traceIds);
    return this.annotations
      .filter((row) => row.projectId === projectId && wanted.has(row.traceId))
      .toSorted((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map(({ projectId: _projectId, ...row }) => row);
  }
}
