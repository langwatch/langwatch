import { useState, useCallback, useEffect, useRef } from "react";
import { apiFetch } from "./useApi.ts";
import type {
  AggregateInfo,
  ReplayResponse,
  ProjectionMeta,
  HandlerMeta,
  ProjectionStateSnapshot,
  ProjectionStateResponse,
} from "../../shared/dejaview.types.ts";

interface DejaViewState {
  aggregates: AggregateInfo[];
  aggregatesLoading: boolean;
  aggregatesError: string | null;
  replay: ReplayResponse | null;
  replayLoading: boolean;
  replayError: string | null;
  eventCursor: number;
  selectedProjectionId: string | null;
  projectionState: ProjectionStateSnapshot[] | null;
  projectionStateLoading: boolean;
  expandedItems: Set<string>;
  showEventDetail: boolean;
}

export function useDejaViewData() {
  const [state, setState] = useState<DejaViewState>({
    aggregates: [],
    aggregatesLoading: false,
    aggregatesError: null,
    replay: null,
    replayLoading: false,
    replayError: null,
    eventCursor: 0,
    selectedProjectionId: null,
    projectionState: null,
    projectionStateLoading: false,
    expandedItems: new Set(),
    showEventDetail: false,
  });

  const currentAggregateId = useRef<string | null>(null);
  const currentTenantId = useRef<string | null>(null);

  const fetchAggregates = useCallback(async (query?: string) => {
    setState((s) => ({ ...s, aggregatesLoading: true, aggregatesError: null }));
    try {
      const params = new URLSearchParams();
      if (query) params.set("q", query);
      params.set("limit", "50");
      const data = await apiFetch<{ aggregates: AggregateInfo[] }>(
        `/api/dejaview/aggregates?${params.toString()}`
      );
      setState((s) => ({ ...s, aggregates: data.aggregates, aggregatesLoading: false }));
    } catch (error) {
      setState((s) => ({
        ...s,
        aggregatesError: error instanceof Error ? error.message : "Failed to fetch",
        aggregatesLoading: false,
      }));
    }
  }, []);

  const loadReplay = useCallback(async (aggregateId: string, tenantId: string, loadAll = false) => {
    currentAggregateId.current = aggregateId;
    currentTenantId.current = tenantId;
    setState((s) => ({
      ...s,
      replayLoading: true,
      replayError: null,
      replay: null,
      eventCursor: 0,
      selectedProjectionId: null,
      projectionState: null,
      expandedItems: new Set(),
      showEventDetail: false,
    }));
    try {
      const allParam = loadAll ? "&all=true" : "";
      const data = await apiFetch<ReplayResponse>(
        `/api/dejaview/replay/${encodeURIComponent(aggregateId)}?tenantId=${encodeURIComponent(tenantId)}${allParam}`
      );
      setState((s) => ({ ...s, replay: data, replayLoading: false }));
    } catch (error) {
      setState((s) => ({
        ...s,
        replayError: error instanceof Error ? error.message : "Failed to load",
        replayLoading: false,
      }));
    }
  }, []);

  const setEventCursor = useCallback((cursor: number | ((prev: number) => number)) => {
    setState((s) => {
      const newCursor = typeof cursor === "function" ? cursor(s.eventCursor) : cursor;
      const maxIndex = (s.replay?.events.length ?? 1) - 1;
      return { ...s, eventCursor: Math.max(0, Math.min(maxIndex, newCursor)) };
    });
  }, []);

  const selectProjection = useCallback((projectionId: string | null) => {
    setState((s) => ({
      ...s,
      selectedProjectionId: projectionId,
      projectionState: null,
    }));
  }, []);

  // Fetch projection state when cursor or selection changes
  const fetchProjectionState = useCallback(async (aggregateId: string, tenantId: string, projectionId: string, cursor: number) => {
    setState((s) => ({ ...s, projectionStateLoading: true }));
    try {
      const data = await apiFetch<ProjectionStateResponse>(
        `/api/dejaview/replay/${encodeURIComponent(aggregateId)}/projection/${encodeURIComponent(projectionId)}?cursor=${cursor}&tenantId=${encodeURIComponent(tenantId)}`
      );
      setState((s) => ({
        ...s,
        projectionState: data.state,
        projectionStateLoading: false,
      }));
    } catch {
      setState((s) => ({ ...s, projectionStateLoading: false }));
    }
  }, []);

  // Auto-fetch projection state when cursor or selection changes
  useEffect(() => {
    const aggId = currentAggregateId.current;
    const tenId = currentTenantId.current;
    if (aggId && tenId && state.selectedProjectionId) {
      fetchProjectionState(aggId, tenId, state.selectedProjectionId, state.eventCursor);
    }
  }, [state.eventCursor, state.selectedProjectionId, fetchProjectionState]);

  const toggleExpanded = useCallback((id: string) => {
    setState((s) => {
      const next = new Set(s.expandedItems);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { ...s, expandedItems: next };
    });
  }, []);

  const toggleEventDetail = useCallback(() => {
    setState((s) => ({ ...s, showEventDetail: !s.showEventDetail }));
  }, []);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) return;

      if (!state.replay) return;

      switch (e.key) {
        case "ArrowLeft":
        case "h":
          e.preventDefault();
          setEventCursor((c) => c - 1);
          break;
        case "ArrowRight":
        case "l":
          e.preventDefault();
          setEventCursor((c) => c + 1);
          break;
        case "e":
          e.preventDefault();
          toggleEventDetail();
          break;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [state.replay, setEventCursor, toggleEventDetail]);

  return {
    ...state,
    fetchAggregates,
    loadReplay,
    setEventCursor,
    selectProjection,
    toggleExpanded,
    toggleEventDetail,
  };
}
