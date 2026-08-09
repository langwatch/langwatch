import { useMemo } from "react";
import {
  type AnnotationByTrace,
  useAnnotationsByTraceIds,
} from "~/hooks/useAnnotationsByTraceIds";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useViewStore } from "../stores/viewStore";
import type { TraceListItem } from "../types/trace";

/** A row with nothing said about it, and the shape one carries before its
 *  reviews arrive. */
const NO_ANNOTATIONS: AnnotationByTrace[] = [];

/**
 * Attaches what reviewers left on each row, read once per visible page.
 *
 * Annotations live in Postgres while the rest of a row comes from the trace
 * summary in ClickHouse, so the two are never joined in a query: the list reads
 * the reviews of the traces it is already showing and lays them over the rows.
 * That read is its own query, and a page whose columns never mention
 * annotations pays nothing.
 *
 * It asks for every annotation on the trace, the ones left on its parts
 * included: a comment on one span is still something said about that trace, and
 * the row is the only place a reader would find it from the list.
 *
 * A failed read leaves the rest of the list standing rather than taking it
 * down, and says so rather than falling back to the empty marker, which would
 * report a reviewed trace as one nobody has looked at.
 */
export function useTraceListAnnotations({
  rows,
  isSamplePreview = false,
}: {
  rows: TraceListItem[];
  /** Fixture rows are not traces anyone can have reviewed. */
  isSamplePreview?: boolean;
}): TraceListItem[] {
  const { project, hasPermission } = useOrganizationTeamProject();
  const needsAnnotations = useViewStore((state) =>
    state.columnOrder.includes("annotations"),
  );
  const canRead = hasPermission("annotations:view");

  // Sorted so two renders of the same page share a query key regardless of the
  // sort column, and joined because the key is compared structurally.
  const traceIdsKey = useMemo(
    () =>
      rows
        .map((row) => row.traceId)
        .sort()
        .join(","),
    [rows],
  );
  const traceIds = useMemo(
    () => (traceIdsKey === "" ? [] : traceIdsKey.split(",")),
    [traceIdsKey],
  );

  const asked = needsAnnotations && !isSamplePreview && traceIds.length > 0;
  const enabled = asked && canRead && !!project?.id;
  const query = useAnnotationsByTraceIds({
    projectId: project?.id ?? "",
    traceIds,
    enabled,
    anchor: "all",
  });

  const byTrace = useMemo(() => {
    const grouped = new Map<string, AnnotationByTrace[]>();
    if (!enabled) return grouped;
    for (const annotation of query.data) {
      const list = grouped.get(annotation.traceId);
      if (list) list.push(annotation);
      else grouped.set(annotation.traceId, [annotation]);
    }
    return grouped;
  }, [enabled, query.data]);

  const isLoading = enabled && query.isLoading;
  // A reader who may not see annotations is in the same position as a failed
  // read: the column cannot say what was left on the trace, so it says that
  // rather than answering "nothing".
  const isUnavailable = asked && (!canRead || query.isError);

  return useMemo(() => {
    if (!asked) return rows;
    return rows.map((row) => ({
      ...row,
      annotations: byTrace.get(row.traceId) ?? NO_ANNOTATIONS,
      annotationsLoading: isLoading,
      annotationsUnavailable: isUnavailable,
    }));
  }, [asked, rows, byTrace, isLoading, isUnavailable]);
}
