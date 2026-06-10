import { useEffect, useMemo } from "react";
import { useDrawerParams, useUpdateDrawerParams } from "~/hooks/useDrawer";
import { useRouter } from "~/utils/compat/next-router";
import {
  type DrawerUrlState,
  type DrawerViewMode,
  isViewMode,
  isVizTab,
  parsePinnedSpansParam,
  serializePinnedSpansParam,
  useDrawerStore,
  type VizTab,
} from "../stores/drawerStore";

const DEFAULTS = {
  // Mirror drawerStore's "summary" default so a popstate into an older
  // drawer URL without `drawer.mode` doesn't hydrate the store back to
  // Trace mode — the store's mount-time default is Summary, and the
  // URL-sync default has to agree or the two paths diverge on back/forward.
  mode: "summary" as DrawerViewMode,
  viz: "waterfall" as VizTab,
} as const;

function parseMode(raw: string | undefined): DrawerViewMode {
  return raw && isViewMode(raw) ? raw : DEFAULTS.mode;
}

function parseViz(raw: string | undefined): VizTab {
  return raw && isVizTab(raw) ? raw : DEFAULTS.viz;
}

function readUrlState(): DrawerUrlState {
  if (typeof window === "undefined") {
    return {
      viewMode: DEFAULTS.mode,
      vizTab: DEFAULTS.viz,
      selectedSpanId: null,
      pinnedSpanIds: [],
    };
  }
  const params = new URLSearchParams(window.location.search);
  const span = params.get("drawer.span");
  return {
    viewMode: parseMode(params.get("drawer.mode") ?? undefined),
    vizTab: parseViz(params.get("drawer.viz") ?? undefined),
    selectedSpanId: span,
    pinnedSpanIds: parsePinnedSpansParam(params.get("drawer.pinnedSpans")),
  };
}

/**
 * Single source of truth = `drawerStore`. The URL is a serialization for
 * persistence (hard reload, deep links) and browser navigation.
 *
 * Two listeners only:
 *  1. Store → URL: when URL-relevant state diverges from URL params, REPLACE
 *     the diff (no new history entry — these params are view-state inside an
 *     already-open drawer). The diff check makes the loop self-terminating —
 *     async router writes can't clobber newer store values, because by the
 *     time a stale write lands, the store and URL re-converge before the next
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
  const router = useRouter();

  // Only mirror view-state into the URL once the drawer is actually open in the
  // URL. openDrawer's `?drawer.open=traceV2Details&drawer.traceId=…` push is an
  // async shallow navigation; if the persisted view-mode differs from the URL
  // (e.g. the operator's last mode was Trace but a freshly opened URL has no
  // drawer.mode yet), the store→URL effect below would fire mid-transition and
  // push `drawer.mode` off a stale asPath that has no drawer.open/traceId yet —
  // clobbering them, so the resulting URL is just `?drawer.mode=trace` and a
  // refresh loses the drawer. Gating on drawer.open closes that window: the
  // effect re-fires once the open lands, and then updateDrawerParams reads an
  // asPath that carries drawer.open + drawer.traceId and preserves them.
  const drawerOpenInUrl = router.query["drawer.open"] === "traceV2Details";

  const viewMode = useDrawerStore((s) => s.viewMode);
  const vizTab = useDrawerStore((s) => s.vizTab);
  const selectedSpanId = useDrawerStore((s) => s.selectedSpanId);
  const pinnedSpanIds = useDrawerStore((s) => s.pinnedSpanIds);

  // Parsed URL view of the same fields. We compare against these — not
  // raw store-vs-store — so a freshly-clicked tab never re-pushes when the
  // URL already reflects it.
  const urlMode = parseMode(params.mode);
  const urlViz = parseViz(params.viz);
  const urlSpan = params.span ?? null;
  // `params.pinnedSpans` is a comma string (or undefined). Serialise our
  // store value the same way so the equality check is one cheap string ==.
  const urlPinnedRaw = params.pinnedSpans ?? "";
  const storePinnedRaw = useMemo(
    () => serializePinnedSpansParam(pinnedSpanIds) ?? "",
    [pinnedSpanIds],
  );

  useEffect(() => {
    if (!drawerOpenInUrl) return;
    const updates: Record<string, string | undefined> = {};
    if (viewMode !== urlMode) updates.mode = viewMode;
    if (vizTab !== urlViz) updates.viz = vizTab;
    if (selectedSpanId !== urlSpan) {
      updates.span = selectedSpanId ?? undefined;
    }
    if (storePinnedRaw !== urlPinnedRaw) {
      // `undefined` removes the param when the store has zero pins —
      // keeps the URL clean instead of trailing an empty `drawer.pinnedSpans=`.
      updates.pinnedSpans = storePinnedRaw || undefined;
    }
    if (Object.keys(updates).length === 0) return;
    // Replace, don't push: mode / viz / span / pinned are view-state WITHIN an
    // already-open drawer, not separate destinations. Pushing a history entry
    // per pane switch let Back land on the same drawer URL minus drawer.mode,
    // which this effect then immediately re-synced (re-adding drawer.mode) -
    // an infinite back-button trap. Replacing folds the open + its view-state
    // into one entry, so Back closes the drawer instead of cycling panes.
    updateDrawerParams(updates, { push: false });
  }, [
    drawerOpenInUrl,
    viewMode,
    vizTab,
    selectedSpanId,
    storePinnedRaw,
    urlMode,
    urlViz,
    urlSpan,
    urlPinnedRaw,
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
