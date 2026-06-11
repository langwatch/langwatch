import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { useFilterStore } from "../stores/filterStore";
import { useViewStore } from "../stores/viewStore";

export interface VisibleTraceIds {
  /** Set of traceIds currently rendered in the list. */
  ids: Set<string>;
  /**
   * The timestamp (ms since epoch) of the most-recently started trace in
   * the current page, or undefined when no data is cached yet.
   */
  topTimestamp: number | undefined;
  /** Current page number (1-based). */
  page: number;
}

/**
 * Reads the current `tracesV2.list` cache entry and returns the set of
 * visible traceIds plus the top-of-page timestamp and current page number.
 *
 * This is a pure cache-read — no network requests are fired. The data
 * comes from whatever TanStack has in memory for the current list query
 * key. Returns an empty set when no cached data exists yet (e.g. on
 * initial load or between pages).
 */
export function useVisibleTraceIds(): VisibleTraceIds {
  const { project } = useOrganizationTeamProject();
  const trpcUtils = api.useUtils();

  const timeRange = useFilterStore((s) => s.debouncedTimeRange);
  const page = useFilterStore((s) => s.page);
  const pageSize = useFilterStore((s) => s.pageSize);
  const queryText = useFilterStore((s) => s.debouncedQueryText);
  const sort = useViewStore((s) => s.sort);

  const cached = trpcUtils.tracesV2.list.getData({
    projectId: project?.id ?? "",
    timeRange: {
      from: timeRange.from,
      to: timeRange.to,
      live: !!timeRange.label,
    },
    sort: { columnId: sort.columnId, direction: sort.direction },
    page,
    pageSize,
    query: queryText || undefined,
  });

  if (!cached) {
    return { ids: new Set(), topTimestamp: undefined, page };
  }

  const items = cached.items as Array<{
    traceId: string;
    startedAt?: number | string | null;
  }>;

  const ids = new Set(items.map((item) => item.traceId));

  // `startedAt` can be a number (ms) or an ISO string depending on the
  // serializer. Normalise both to ms.
  const topTimestamp: number | undefined =
    items.length > 0
      ? (() => {
          const raw = items[0]?.startedAt;
          if (raw === null || raw === undefined) return undefined;
          if (typeof raw === "number") return raw;
          const parsed = Date.parse(raw);
          return isNaN(parsed) ? undefined : parsed;
        })()
      : undefined;

  return { ids, topTimestamp, page };
}
