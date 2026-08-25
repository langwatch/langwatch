import { Gauge } from "lucide-react";
import { AnnotationHoverChip } from "./AnnotationHoverChip";
import {
  type AnnotationWithUser,
  annotationScoresLine,
  countAnnotationScores,
} from "./annotationRow";

/**
 * How a row was scored, as a count that opens the scores themselves on hover.
 *
 * The pill counts the scores given rather than the reviewers who gave them: a
 * reader asking "how much of this was judged" means the judgements, and one
 * reviewer answering three score keys is three of them.
 */
export function AnnotationScoresChip({
  annotations,
  traceId,
  scoreNamesById,
}: {
  annotations: AnnotationWithUser[];
  traceId: string;
  /** The project's score names by id. Without it a score reads by its id. */
  scoreNamesById?: Map<string, string>;
}) {
  return (
    <AnnotationHoverChip
      annotations={annotations}
      traceId={traceId}
      icon={<Gauge size={12} />}
      testId="annotation-scores-chip"
      count={countAnnotationScores(annotations)}
      countLabel={(count) => `${count} ${count === 1 ? "score" : "scores"}`}
      textOf={(annotation) => annotationScoresLine({ annotation, scoreNamesById })}
    />
  );
}
