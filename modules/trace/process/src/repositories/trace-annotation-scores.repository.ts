/**
 * Annotation's score names as trace reads them through annotation's shared table.
 * Spec: modules/trace/specs/trace-annotations.feature
 */
export abstract class TraceAnnotationScoresReadRepository {
  /** Every score definition of the project, soft-deleted ones included. */
  abstract findScoreNames(args: { projectId: string }): Promise<{ id: string; name: string }[]>;
}
