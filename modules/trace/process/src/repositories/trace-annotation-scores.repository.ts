import type { FoldProjectionStore } from "@langwatch/eventing";
import { z } from "zod";

/** One score definition's name as trace folds it; a rename names old results too. */
export const traceAnnotationScoreFoldStateSchema = z.object({
  scoreId: z.string(),
  name: z.string().nullable(),
  /** When the score took `name`; the newest name wins on it. */
  namedAt: z.number(),
  /** Raised on every fold; the replacing table's version, so the newest write wins. */
  revision: z.number(),
  LastEventOccurredAt: z.number(),
});
export type TraceAnnotationScoreFoldState = z.infer<typeof traceAnnotationScoreFoldStateSchema>;

/** The peer fold's version; a stored row of another version is re-folded from annotation's log. */
export const TRACE_ANNOTATION_SCORES_PROJECTION_VERSION = "2026-10-08" as const;

/** The read over trace's folded score names. Spec: modules/trace/specs/trace-annotations.feature */
export abstract class TraceAnnotationScoresReadRepository {
  /** Every named score definition of the project, soft-deleted ones included. */
  abstract findScoreNames(args: { projectId: string }): Promise<{ id: string; name: string }[]>;
}

/** The peer fold's store and the read over the same rows. */
export type TraceAnnotationScoresRepository = FoldProjectionStore<TraceAnnotationScoreFoldState> &
  TraceAnnotationScoresReadRepository;
