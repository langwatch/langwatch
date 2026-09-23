import type { AnnotationWithUser } from "@langwatch/annotation-contract";
import { Lightbulb } from "lucide-react";

import { AnnotationHoverChip } from "./annotation-hover-chip.tsx";

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
