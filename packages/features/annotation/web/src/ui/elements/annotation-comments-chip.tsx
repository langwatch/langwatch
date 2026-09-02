import { MessageCircle } from "lucide-react";
import { AnnotationHoverChip } from "./annotation-hover-chip";
import type { AnnotationWithUser } from "@langwatch/annotation-contract";

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
