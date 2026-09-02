import type { AnnotationByTrace } from "../../../use-annotations-by-trace-ids";
import { focusSectionForAnchorPath } from "../../hooks/use-jump-to-annotation-anchor";

/**
 * How many comments each section of one element carries, by section id.
 *
 * A section the reader left closed hides everything said inside it, so the
 * header carries the count and the reader knows there is something to open.
 * Comments about parts this build has no section for are counted nowhere
 * rather than heaped onto the first section, which would send the reader
 * somewhere the comment is not.
 */
export function commentCountsBySection({
  comments,
  anchorId,
}: {
  comments: AnnotationByTrace[];
  /** The span whose sections these are, or the trace id for its summary. */
  anchorId: string;
}): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const comment of comments) {
    if (comment.anchorKind !== "field") continue;
    if (comment.anchorId !== anchorId) continue;
    const section = focusSectionForAnchorPath(comment.anchorPath);
    if (!section) continue;
    counts[section] = (counts[section] ?? 0) + 1;
  }
  return counts;
}
