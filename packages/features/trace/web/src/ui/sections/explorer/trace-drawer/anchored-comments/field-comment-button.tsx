import { type TraceAnchor, useAnchoredAnnotations } from "../../hooks/use-anchored-annotations";
import { AnchorCommentButton } from "./anchor-comment-button";

/**
 * The comment affordance for one field, reading its own comments.
 *
 * A panel header holds a handful of these rather than a row apiece, so each one
 * asking the trace what it carries costs nothing extra: they all share the one
 * read. The dense rows are the other way round and are handed their comments by
 * the surface that drew them.
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
