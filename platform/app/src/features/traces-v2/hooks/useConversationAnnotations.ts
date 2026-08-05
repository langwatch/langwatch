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
 * `keepPreviousData` keeps the previous conversation's annotations on screen
 * while the next one loads, so moving between turns does not blank the rail.
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

  const all = query.data;

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
