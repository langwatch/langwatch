import { annotationScoreOptionsSchema } from "@langwatch/annotation-contract";
import type { FoldProjectionStore } from "@langwatch/eventing";
import { z } from "zod";

/** An annotation's content as annotation's newest created or updated fact carried it. */
export const traceAnnotationContentSchema = z.object({
  comment: z.string().nullable(),
  isThumbsUp: z.boolean().nullable(),
  expectedOutput: z.string().nullable(),
  scoreOptions: annotationScoreOptionsSchema,
  anchorKind: z.string().nullable(),
  anchorId: z.string().nullable(),
  anchorPath: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type TraceAnnotationContent = z.infer<typeof traceAnnotationContentSchema>;

/** One annotation as trace folds it: content until a delete, then a tombstone for good. */
export const traceAnnotationFoldStateSchema = z.object({
  annotationId: z.string(),
  traceId: z.string(),
  content: traceAnnotationContentSchema.nullable(),
  deleted: z.boolean(),
  /** Raised on every fold; the replacing table's version, so the newest write wins. */
  revision: z.number(),
  LastEventOccurredAt: z.number(),
});
export type TraceAnnotationFoldState = z.infer<typeof traceAnnotationFoldStateSchema>;

/** The peer fold's version; a stored row of another version is re-folded from annotation's log. */
export const TRACE_ANNOTATIONS_PROJECTION_VERSION = "2026-10-08" as const;

/** A live annotation on a trace, as trace's legacy read attaches it. */
export type TraceAnnotationRow = TraceAnnotationContent & { id: string; traceId: string };

/** The read over trace's folded annotations. Spec: modules/trace/specs/trace-annotations.feature */
export abstract class TraceAnnotationsReadRepository {
  /** Every live annotation on these traces, whatever its anchor; deleted ones are absent. */
  abstract findForTraces(args: {
    projectId: string;
    traceIds: string[];
  }): Promise<TraceAnnotationRow[]>;
}

/** The peer fold's store and the read over the same rows. */
export type TraceAnnotationsRepository = FoldProjectionStore<TraceAnnotationFoldState> &
  TraceAnnotationsReadRepository;
