import { useEffect } from "react";
import { useDrawerParams, useUpdateDrawerParams } from "~/hooks/useDrawer";
import {
  type DrawerTab,
  type DrawerUrlState,
  type DrawerViewMode,
  isDrawerTab,
  isViewMode,
  isVizTab,
  useDrawerStore,
  type VizTab,
} from "../stores/drawerStore";

const DEFAULTS = {
  mode: "trace" as DrawerViewMode,
  viz: "waterfall" as VizTab,
  tab: "summary" as DrawerTab,
} as const;

function parseMode(raw: string | undefined): DrawerViewMode {
  return raw && isViewMode(raw) ? raw : DEFAULTS.mode;
}

function parseViz(raw: string | undefined): VizTab {
  return raw && isVizTab(raw) ? raw : DEFAULTS.viz;
}

function parseTab(raw: string | undefined, hasSpan: boolean): DrawerTab {
  if (raw && isDrawerTab(raw)) return raw;
  return hasSpan ? "span" : DEFAULTS.tab;
}

function readUrlState(): DrawerUrlState {
  if (typeof window === "undefined") {
    return {
      viewMode: DEFAULTS.mode,
      vizTab: DEFAULTS.viz,
      activeTab: DEFAULTS.tab,
      selectedSpanId: null,
    };
  }
  const params = new URLSearchParams(window.location.search);
  const span = params.get("drawer.span");
  return {
    viewMode: parseMode(params.get("drawer.mode") ?? undefined),
    vizTab: parseViz(params.get("drawer.viz") ?? undefined),
    activeTab: parseTab(params.get("drawer.tab") ?? undefined, !!span),
    selectedSpanId: span,
  };
}

/**
 * Single source of truth = `drawerStore`. The URL is a serialization for
 * persistence (hard reload, deep links) and browser navigation.
 *
 * Two listeners only:
 *  1. Store → URL: when URL-relevant state diverges from URL params, push
 *     the diff. The diff check makes the loop self-terminating — async
 *     router pushes can't clobber newer store values, because by the time
 *     a stale push lands, the store and URL re-converge before the next
 *     write fires.
 *  2. `popstate` → store: browser back/forward re-hydrates the store from
 *     the URL. Subsequent re-render sees store == URL → no echo push.
 *
 * No bidirectional `useEffect`s, no `eslint-disable`. The flip-back bug
 * (Trace → Conversation → Trace landing back on Conversation) cannot
 * happen here because nothing reads the URL into the store except popstate
 * and mount, neither of which fires on our own pushes.
 */
export function useDrawerUrlSync() {
  const params = useDrawerParams();
  const updateDrawerParams = useUpdateDrawerParams();

  const viewMode = useDrawerStore((s) => s.viewMode);
  const vizTab = useDrawerStore((s) => s.vizTab);
  const activeTab = useDrawerStore((s) => s.activeTab);
  const selectedSpanId = useDrawerStore((s) => s.selectedSpanId);

  // Parsed URL view of the same fields. We compare against these — not
  // raw store-vs-store — so a freshly-clicked tab never re-pushes when the
  // URL already reflects it.
  const urlMode = parseMode(params.mode);
  const urlViz = parseViz(params.viz);
  const urlSpan = params.span ?? null;
  const urlTab = parseTab(params.tab, !!urlSpan);

  useEffect(() => {
    const updates: Record<string, string | undefined> = {};
    if (viewMode !== urlMode) updates.mode = viewMode;
    if (vizTab !== urlViz) updates.viz = vizTab;
    if (activeTab !== urlTab) updates.tab = activeTab;
    if (selectedSpanId !== urlSpan) {
      updates.span = selectedSpanId ?? undefined;
    }
    if (Object.keys(updates).length === 0) return;
    updateDrawerParams(updates);
  }, [
    viewMode,
    vizTab,
    activeTab,
    selectedSpanId,
    urlMode,
    urlViz,
    urlTab,
    urlSpan,
    updateDrawerParams,
  ]);

  useEffect(() => {
    const onPopState = () => {
      useDrawerStore.getState().hydrateUrlState(readUrlState());
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
}
