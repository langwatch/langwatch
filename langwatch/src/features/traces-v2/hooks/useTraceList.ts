import { useEffect, useMemo, useRef, useState } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { useFilterStore } from "../stores/filterStore";
import { useFreshnessSignal } from "../stores/freshnessSignal";
import { useViewStore } from "../stores/viewStore";
import type { TraceEvalResult, TraceListItem } from "../types/trace";

const NEW_ID_TTL_MS = 3500;

interface TraceListResult {
  data: TraceListItem[];
  totalHits: number;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  error: unknown;
  newIds: Set<string>;
}

const LENS_FILTERS: Record<string, string> = {
  errors: "status:error",
};

export function useTraceList(): TraceListResult {
  const { project } = useOrganizationTeamProject();
  const timeRange = useFilterStore((s) => s.debouncedTimeRange);
  const page = useFilterStore((s) => s.page);
  const pageSize = useFilterStore((s) => s.pageSize);
  const queryText = useFilterStore((s) => s.debouncedQueryText);
  const sort = useViewStore((s) => s.sort);
  const activeLensId = useViewStore((s) => s.activeLensId);

  const effectiveQuery = useMemo(() => {
    const lensFilter = LENS_FILTERS[activeLensId];
    if (!lensFilter) return queryText || undefined;
    if (!queryText) return lensFilter;
    return `${queryText} AND ${lensFilter}`;
  }, [queryText, activeLensId]);

  const query = api.tracesV2.list.useQuery(
    {
      projectId: project?.id ?? "",
      timeRange: { from: timeRange.from, to: timeRange.to, live: !!timeRange.label },
      sort: { columnId: sort.columnId, direction: sort.direction },
      page,
      pageSize,
      query: effectiveQuery,
    },
    {
      enabled: !!project?.id,
      staleTime: 30_000,
      keepPreviousData: true,
    },
  );

  const data = useMemo((): TraceListItem[] => {
    if (!query.data) return [];

    const evalMap = (query.data.evaluations ?? {}) as Record<
      string,
      TraceEvalResult[]
    >;

    return (query.data.items as TraceListItem[]).map((item) => ({
      ...item,
      evaluations: (evalMap[item.traceId] ?? []).map((e) => ({
        evaluatorId: e.evaluatorId,
        evaluatorName: e.evaluatorName,
        status: e.status,
        score: e.score,
        passed: e.passed,
        label: e.label,
      })),
      events: item.events ?? [],
    }));
  }, [query.data]);

  // Track which trace IDs are "new" — arrived since the hook mounted, AND
  // started after mount time. The timestamp gate keeps filter / page / sort
  // changes from making every backfilled trace pulse.
  const mountedAtRef = useRef(Date.now());
  const seenIdsRef = useRef<Set<string>>(new Set());
  const [newIds, setNewIds] = useState<Set<string>>(() => new Set());
  const expiryTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );

  useEffect(() => {
    if (!query.data) return;

    const seen = seenIdsRef.current;
    const fresh: string[] = [];
    for (const trace of data) {
      const id = trace.traceId;
      if (seen.has(id)) continue;
      seen.add(id);
      if (trace.timestamp > mountedAtRef.current) {
        fresh.push(id);
      }
    }

    if (fresh.length === 0) return;

    setNewIds((prev) => {
      const next = new Set(prev);
      for (const id of fresh) next.add(id);
      return next;
    });

    for (const id of fresh) {
      const existing = expiryTimersRef.current.get(id);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => {
        expiryTimersRef.current.delete(id);
        setNewIds((prev) => {
          if (!prev.has(id)) return prev;
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }, NEW_ID_TTL_MS);
      expiryTimersRef.current.set(id, timer);
    }
  }, [data, query.data]);

  useEffect(() => {
    const timers = expiryTimersRef.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  // Publish refetch state so other components (top progress bar, refresh icon)
  // can react. Only true for refetches — initial load uses skeleton state.
  const setRefreshing = useFreshnessSignal((s) => s.setRefreshing);
  const isRefetching = query.isFetching && !query.isLoading;
  useEffect(() => {
    setRefreshing(isRefetching);
  }, [isRefetching, setRefreshing]);

  return {
    data,
    totalHits: query.data?.totalHits ?? 0,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error,
    newIds,
  };
}
