import { useMemo } from "react";
import {
  type AnnotationByTrace,
  useAnnotationsByTraceIds,
} from "~/hooks/useAnnotationsByTraceIds";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";

export interface ConversationAnnotations {
  /** Annotations grouped by the turn they were left on. */
  byTrace: Map<string, AnnotationByTrace[]>;
  all: AnnotationByTrace[];
  hasAny: boolean;
  isLoading: boolean;
}

/**
 * Every annotation on a conversation, read once for all of its turns.
 *
 * The turn cards, the rail, and the drawer's header chip all want the same
 * list, and each one asking separately meant the same rows fetched several
 * times over. One subscription here, grouped once, and the query key is stable
 * across callers because the ids are sorted before they become one.
 *
 * `keepPreviousData` keeps annotations on screen while a turn list that grew
 * is re-read, so the rail does not blank between pages. The retained rows are
 * held to the turns being asked about, because the same retention hands back
 * the last conversation's annotations while the next one is still loading, and
 * counting those would credit this conversation with another one's work.
 */
export function useConversationAnnotations(
  traceIds: string[],
): ConversationAnnotations {
  const { project, hasPermission } = useOrganizationTeamProject();

  const query = useAnnotationsByTraceIds({
    projectId: project?.id ?? "",
    traceIds,
    enabled: !!project?.id && hasPermission("annotations:view"),
    keepPreviousData: true,
  });

  const requested = useMemo(() => new Set(traceIds), [traceIds]);
  const all = useMemo(
    () => query.data.filter((annotation) => requested.has(annotation.traceId)),
    [query.data, requested],
  );

  const byTrace = useMemo(() => {
    const map = new Map<string, AnnotationByTrace[]>();
    for (const annotation of all) {
      const list = map.get(annotation.traceId);
      if (list) list.push(annotation);
      else map.set(annotation.traceId, [annotation]);
    }
    return map;
  }, [all]);

  return {
    byTrace,
    all,
    hasAny: all.length > 0,
    isLoading: query.isLoading,
  };
}
