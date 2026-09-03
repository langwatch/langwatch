import type { AnnotationWithUser } from "@langwatch/annotation-contract";
import { Gauge } from "lucide-react";
import { AnnotationHoverChip } from "./annotation-hover-chip";
import { annotationScoresLine, countAnnotationScores } from "../../model/annotation-row";

export function AnnotationScoresChip({
  annotations,
  traceId,
  scoreNamesById,
}: {
  annotations: AnnotationWithUser[];
  traceId: string;
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
