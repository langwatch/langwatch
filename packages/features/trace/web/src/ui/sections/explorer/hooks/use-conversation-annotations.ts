import { useMemo } from "react";
import {
  type AnnotationByTrace,
  useAnnotationsByTraceIds,
} from "../../use-annotations-by-trace-ids";
import { useOrganizationTeamProject } from "../../../../behavior/use-organization-team-project";

export interface ConversationAnnotations {
  /**
   * Comments about a turn as a whole, by the turn they were left on. This is
   * what a turn's count reads, so a reviewer who marked three spans of one turn
   * must not change what it says.
   */
  byTrace: Map<string, AnnotationByTrace[]>;
  /**
   * Comments about one part of a turn, by the turn holding that part. They read
   * beside the turn, each naming the part it is about, and they are counted
   * nowhere.
   */
  byAnchor: Map<string, AnnotationByTrace[]>;
  all: AnnotationByTrace[];
  hasAny: boolean;
  isLoading: boolean;
}

/**
 * Every annotation on a conversation, read once for all of its turns.
 */
export function useConversationAnnotations(traceIds: string[]): ConversationAnnotations {
  const { project, hasPermission } = useOrganizationTeamProject();

  const query = useAnnotationsByTraceIds({
    projectId: project?.id ?? "",
    traceIds,
    enabled: !!project?.id && hasPermission("annotations:view"),
    keepPreviousData: true,
    anchor: "all",
  });

  const requested = useMemo(() => new Set(traceIds), [traceIds]);
  const all = useMemo(
    () => query.data.filter((annotation) => requested.has(annotation.traceId)),
    [query.data, requested],
  );

  const { byTrace, byAnchor } = useMemo(() => {
    const byTrace = new Map<string, AnnotationByTrace[]>();
    const byAnchor = new Map<string, AnnotationByTrace[]>();
    for (const annotation of all) {
      const group = annotation.anchorKind ? byAnchor : byTrace;
      const list = group.get(annotation.traceId);
      if (list) list.push(annotation);
      else group.set(annotation.traceId, [annotation]);
    }
    return { byTrace, byAnchor };
  }, [all]);

  return {
    byTrace,
    byAnchor,
    all,
    hasAny: all.length > 0,
    isLoading: query.isLoading,
  };
}
