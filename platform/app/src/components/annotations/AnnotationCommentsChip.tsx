import { MessageCircle } from "lucide-react";
import { AnnotationHoverChip } from "./AnnotationHoverChip";
import type { AnnotationWithUser } from "./annotationRow";

/**
 * The comments left on a row, as a count that opens the comments themselves on
 * hover. Each one names the part of the trace it was left on, since a comment
 * on one span says something different from a comment on the whole trace.
 */
export function AnnotationCommentsChip({
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
      icon={<MessageCircle size={12} />}
      testId="annotation-comments-chip"
      countLabel={(count) => `${count} ${count === 1 ? "comment" : "comments"}`}
      textOf={(annotation) => annotation.comment}
    />
  );
}
