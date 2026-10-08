import type { ProjectionAnnotation } from "@langwatch/annotation-contract";

/**
 * Annotation's rows as trace reads them through annotation's shared table.
 * Spec: modules/trace/specs/trace-annotations.feature
 */
export abstract class TraceAnnotationsReadRepository {
  /** Every annotation on these traces whatever its anchor, oldest first. */
  abstract findForTraces(args: {
    projectId: string;
    traceIds: string[];
  }): Promise<ProjectionAnnotation[]>;
}
