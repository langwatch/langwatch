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

const LENS_FILTERS: Readonly<Record<string, string>> = {
  errors: "status:error",
};

function buildEffectiveQuery(
  queryText: string,
  activeLensId: string,
): string | undefined {
  const lensFilter = LENS_FILTERS[activeLensId];
  if (!lensFilter) return queryText || undefined;
  if (!queryText) return lensFilter;
  return `${queryText} AND ${lensFilter}`;
}

/**
 * Track which trace IDs are "new": arrived since this hook mounted AND started
 * after mount time. The timestamp gate keeps filter / page / sort changes from
 * making every backfilled trace pulse. Each new id self-evicts after NEW_ID_TTL_MS.
 */
function useNewlyArrivedTraceIds(traces: TraceListItem[]): Set<string> {
  const mountedAtRef = useRef(Date.now());
  const seenIdsRef = useRef<Set<string>>(new Set());
  const expiryTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );
  const [newIds, setNewIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    const seen = seenIdsRef.current;
    const fresh: string[] = [];
    for (const trace of traces) {
      if (seen.has(trace.traceId)) continue;
      seen.add(trace.traceId);
      if (trace.timestamp > mountedAtRef.current) fresh.push(trace.traceId);
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
  }, [traces]);

  useEffect(() => {
    const timers = expiryTimersRef.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  return newIds;
}

export function useTraceList(): TraceListResult {
  const { project } = useOrganizationTeamProject();
  const timeRange = useFilterStore((s) => s.debouncedTimeRange);
  const page = useFilterStore((s) => s.page);
  const pageSize = useFilterStore((s) => s.pageSize);
  const queryText = useFilterStore((s) => s.debouncedQueryText);
  const sort = useViewStore((s) => s.sort);
  const activeLensId = useViewStore((s) => s.activeLensId);

  const effectiveQuery = useMemo(
    () => buildEffectiveQuery(queryText, activeLensId),
    [queryText, activeLensId],
  );

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

  const data = useMemo<TraceListItem[]>(() => {
    if (!query.data) return [];
    const evalMap = (query.data.evaluations ?? {}) as Record<
      string,
      TraceEvalResult[]
    >;
    return (query.data.items as TraceListItem[]).map((item) => ({
      ...item,
      spanCount: item.spanCount ?? 0,
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

  const newIds = useNewlyArrivedTraceIds(data);

  const setRefreshing = useFreshnessSignal((s) => s.setRefreshing);
  const isRefetching = query.isFetching && !query.isLoading;

  // Dim the table only when the user explicitly switches view (filter, sort,
  // page, pageSize, or a non-rolling time range change). isPreviousData fires
  // on every key change including the rolling-time-range tail update, which
  // would dim every minute on a live view. Compute a stable "view key" that
  // ignores from/to drift while a label preset is active.
  const viewKey = useMemo(
    () =>
      JSON.stringify({
        q: effectiveQuery,
        s: sort,
        p: page,
        ps: pageSize,
        t: timeRange.label
          ? { l: timeRange.label }
          : { f: timeRange.from, to: timeRange.to },
      }),
    [
      effectiveQuery,
      sort,
      page,
      pageSize,
      timeRange.label,
      timeRange.from,
      timeRange.to,
    ],
  );
  const prevViewKeyRef = useRef(viewKey);
  const [viewSwitching, setViewSwitching] = useState(false);
  useEffect(() => {
    if (prevViewKeyRef.current !== viewKey) {
      prevViewKeyRef.current = viewKey;
      setViewSwitching(true);
    }
  }, [viewKey]);
  useEffect(() => {
    if (viewSwitching && !query.isFetching && query.isFetched) {
      setViewSwitching(false);
    }
  }, [viewSwitching, query.isFetching, query.isFetched]);

  const setReplacingData = useFreshnessSignal((s) => s.setReplacingData);
  useEffect(() => {
    setReplacingData(viewSwitching && query.isPreviousData);
  }, [viewSwitching, query.isPreviousData, setReplacingData]);

  // Publish refresh state so the aurora progress bar appears every time the
  // user updates the query (filter, sort, page, time range). Cache hits can
  // resolve before isFetching ever flips, so we drive visibility from
  // viewSwitching too and hold the bar visible for a minimum duration so
  // the user always sees that something happened.
  const MIN_REFRESH_VISIBLE_MS = 450;
  const wantsRefresh = isRefetching || viewSwitching;
  const refreshStartedAtRef = useRef<number | null>(null);
  const refreshClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  useEffect(() => {
    if (wantsRefresh) {
      if (refreshClearTimerRef.current) {
        clearTimeout(refreshClearTimerRef.current);
        refreshClearTimerRef.current = null;
      }
      if (refreshStartedAtRef.current === null) {
        refreshStartedAtRef.current = Date.now();
        setRefreshing(true);
      }
      return;
    }
    if (refreshStartedAtRef.current === null) return;
    const elapsed = Date.now() - refreshStartedAtRef.current;
    const remaining = Math.max(0, MIN_REFRESH_VISIBLE_MS - elapsed);
    refreshClearTimerRef.current = setTimeout(() => {
      setRefreshing(false);
      refreshStartedAtRef.current = null;
      refreshClearTimerRef.current = null;
    }, remaining);
  }, [wantsRefresh, setRefreshing]);
  useEffect(
    () => () => {
      if (refreshClearTimerRef.current) clearTimeout(refreshClearTimerRef.current);
    },
    [],
  );

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
