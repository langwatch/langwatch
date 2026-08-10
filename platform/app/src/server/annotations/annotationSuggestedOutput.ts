import { readableAnnotationAnchor } from "./annotationAnchor";

/**
 * An annotation as this rule reads it. Structural rather than the Prisma row,
 * so a projection row that carries only the anchor columns fits the same shape.
 */
export interface AnnotationSuggestionSource {
  expectedOutput?: string | null;
  anchorKind?: string | null;
  anchorId?: string | null;
  anchorPath?: string | null;
}

/**
 * The suggestion an annotation makes about the trace's expected output, or null
 * when it makes none.
 *
 * A comment about the whole trace, and a comment on the trace's own output,
 * both suggest what the trace should have answered. Every other anchor suggests
 * something else: a span's field, or nothing at all. Reading those as the
 * trace's expected output is how a suggested INPUT ends up in an
 * `expected_output` column, which is a wrong answer rather than a missing one,
 * so they read as no suggestion here.
 *
 * The anchor is normalised first, so a kind stored by a newer build reads as a
 * comment about the trace as a whole, exactly as it does everywhere else.
 */
export function annotationSuggestedOutput({
  annotation,
  traceId,
}: {
  annotation: AnnotationSuggestionSource;
  traceId: string;
}): string | null {
  const anchor = readableAnnotationAnchor({
    anchorKind: annotation.anchorKind ?? null,
    anchorId: annotation.anchorId ?? null,
    anchorPath: annotation.anchorPath ?? null,
  });

  if (!anchor.anchorKind) return annotation.expectedOutput ?? null;

  const isTraceOutput =
    anchor.anchorKind === "field" &&
    anchor.anchorId === traceId &&
    anchor.anchorPath === "output";

  return isTraceOutput ? (annotation.expectedOutput ?? null) : null;
}
