import {
  annotationScores,
  describeAnnotationAnchor,
  readableAnnotationAnchor,
  type AnnotationAnchorStorage,
  type ScoredAnnotation,
} from "@langwatch/annotation-contract";

export {
  annotationScores,
  countAnnotationScores,
  type AnnotationScoreAnswer,
} from "@langwatch/annotation-contract";

/** The part of a trace an annotation was left on, in words. */
export function annotationAnchorLabel({
  annotation,
  traceId,
}: {
  annotation: AnnotationAnchorStorage;
  traceId: string;
}): string | null {
  return describeAnnotationAnchor({ anchor: readableAnnotationAnchor(annotation), traceId });
}

export function annotationScoresLine({
  annotation,
  scoreNamesById,
}: {
  annotation: ScoredAnnotation;
  scoreNamesById?: Map<string, string>;
}): string | null {
  const scores = annotationScores({ annotation, scoreNamesById });

  if (scores.length === 0) {
    return null;
  }

  return scores
    .map((score) => {
      const answered = `${score.name}: ${score.values.join(", ")}`;

      return score.reason ? `${answered} (${score.reason})` : answered;
    })
    .join(" · ");
}
