import { type TraceAnchor, useAnchoredAnnotations } from "../../hooks/use-anchored-annotations.ts";
import { AnchorCommentButton } from "./anchor-comment-button.tsx";

/**
 * The comment affordance for one field, reading its own comments.
 */
export function FieldCommentButton({ traceId, anchor }: { traceId: string; anchor: TraceAnchor }) {
  const annotations = useAnchoredAnnotations();
  return (
    <AnchorCommentButton
      traceId={traceId}
      anchor={anchor}
      comments={annotations.commentsAt(anchor)}
    />
  );
}
