/** One annotation, as the backfill needs to read it. */
export type BackfillableAnnotation = Readonly<{ id: string; traceId: string }>;

/**
 * Where the annotations of record are read from.
 *
 * Annotations are listed one project at a time because the multitenancy guard
 * rejects any Annotation query that does not name its project — so the
 * project list is part of this port rather than something the caller is
 * trusted to remember.
 */
export abstract class AnnotationBackfillSourcePort {
  abstract listProjectIds(): Promise<readonly string[]>;
  abstract listAnnotations(input: {
    projectId: string;
  }): Promise<readonly BackfillableAnnotation[]>;
}

/** The one write the backfill makes, as the Trace aggregate's own command. */
export abstract class TraceAnnotationSyncPort {
  abstract bulkSyncAnnotations(input: {
    tenantId: string;
    traceId: string;
    annotationIds: readonly string[];
    occurredAt: number;
  }): Promise<void>;
}
