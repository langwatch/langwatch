import { Lightbulb } from "lucide-react";
import { AnnotationHoverChip } from "./AnnotationHoverChip";
import type { AnnotationWithUser } from "./annotationRow";

/**
 * The better outputs suggested on a row, as a count that opens the suggestions
 * themselves on hover. A suggestion in full is a wall of text, so the chip keeps
 * the table scannable and the hover keeps the text one gesture away.
 */
export function AnnotationSuggestionsChip({
  annotations,
  traceId,
}: {
  annotations: AnnotationWithUser[];
  traceId: string;
}) {
  return (
    <AnnotationHoverChip
      annotations={annotations}
      traceId={traceId}
      icon={<Lightbulb size={12} />}
      testId="annotation-suggestions-chip"
      countLabel={(count) => `${count} ${count === 1 ? "suggestion" : "suggestions"}`}
      textOf={(annotation) => annotation.expectedOutput}
    />
  );
}
