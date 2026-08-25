import { useMemo } from "react";
import {
  type AnnotationByTrace,
  useAnnotationsByTraceIds,
} from "~/hooks/useAnnotationsByTraceIds";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { AnnotationAnchorKind } from "~/server/annotations/annotationAnchor";
import { useIsReadOnlyTrace } from "../context/TraceViewerContext";
import { useTraceQueryArgs } from "./useTraceQueryArgs";

/** The part of the open trace a surface points at. */
export interface TraceAnchor {
  anchorKind: AnnotationAnchorKind;
  /** The span the part belongs to, or the trace id for the trace's own parts. */
  anchorId: string;
  /** Which part of it, when the anchor is narrower than the whole element. */
  anchorPath?: string;
}

const NO_COMMENTS: AnnotationByTrace[] = [];
const NO_ANNOTATIONS: AnnotationByTrace[] = [];

/**
 * One key per part of a trace, so a comment can be found by what it is about.
 *
 * A null and an absent segment are the same thing, because a comment read back
 * from the server carries nulls where a surface pointing at the same part
 * carries nothing at all.
 */
export function traceAnchorKey(anchor: {
  anchorKind?: string | null;
  anchorId?: string | null;
  anchorPath?: string | null;
}): string {
  return [anchor.anchorKind ?? "", anchor.anchorId ?? "", anchor.anchorPath ?? ""].join(
    "\u0000",
  );
}

export interface AnchoredAnnotations {
  /** What was said about one part of the trace, oldest first. */
  commentsAt: (anchor: TraceAnchor) => AnnotationByTrace[];
  /** Every comment on the open trace, the ones about the whole of it included. */
  all: AnnotationByTrace[];
  isLoading: boolean;
}

/**
 * Every comment on the trace the drawer has open, grouped by the part of it
 * each one is about.
 *
 * Read once per surface rather than once per row: the waterfall, the attribute
 * table and the section stack each ask for the whole trace's comments and pick
 * the ones for the row they are drawing, so a trace with a hundred spans still
 * costs one read. Every caller shares the same query key, so several of them on
 * screen together share one fetch.
 *
 * A viewer holding a share link reads no comments at all: the affordance is not
 * offered there, and asking would fire an authenticated query that legitimately
 * cannot be answered.
 */
export function useAnchoredAnnotations(): AnchoredAnnotations {
  const { project, hasPermission } = useOrganizationTeamProject();
  const { traceId } = useTraceQueryArgs();
  const isReadOnly = useIsReadOnlyTrace();

  const traceIds = useMemo(() => (traceId ? [traceId] : []), [traceId]);

  const query = useAnnotationsByTraceIds({
    projectId: project?.id ?? "",
    traceIds,
    enabled:
      !!project?.id && !!traceId && !isReadOnly && hasPermission("annotations:view"),
    anchor: "all",
  });

  const all = query.data.length > 0 ? query.data : NO_ANNOTATIONS;

  const byAnchor = useMemo(() => {
    const map = new Map<string, AnnotationByTrace[]>();
    for (const annotation of all) {
      if (!annotation.anchorKind || !annotation.anchorId) continue;
      const key = traceAnchorKey(annotation);
      const list = map.get(key);
      if (list) list.push(annotation);
      else map.set(key, [annotation]);
    }
    return map;
  }, [all]);

  return useMemo(
    () => ({
      commentsAt: (anchor: TraceAnchor) =>
        byAnchor.get(traceAnchorKey(anchor)) ?? NO_COMMENTS,
      all,
      isLoading: query.isLoading,
    }),
    [byAnchor, all, query.isLoading],
  );
}
