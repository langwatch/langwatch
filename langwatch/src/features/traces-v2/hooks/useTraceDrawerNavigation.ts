import { useCallback } from "react";
import { useDrawer } from "~/hooks/useDrawer";
import { type DrawerViewMode, useDrawerStore } from "../stores/drawerStore";

/**
 * Trace-to-trace navigation inside the v2 drawer with a back stack.
 *
 * `useDrawer` skips same-drawer navigations from its stack, so jumping
 * between traces in the conversation view would lose history. We keep our
 * own stack in `drawerStore` so the drawer can offer "back" through prior
 * traces (and remember which view mode the user was in).
 */
export function useTraceDrawerNavigation() {
  const { openDrawer } = useDrawer();
  const pushTraceHistory = useDrawerStore((s) => s.pushTraceHistory);
  const popTraceHistory = useDrawerStore((s) => s.popTraceHistory);
  const setViewMode = useDrawerStore((s) => s.setViewMode);
  const traceBackStack = useDrawerStore((s) => s.traceBackStack);

  const navigateToTrace = useCallback(
    ({
      fromTraceId,
      fromViewMode,
      toTraceId,
      toTimestamp,
      toViewMode,
    }: {
      fromTraceId: string;
      fromViewMode: DrawerViewMode;
      toTraceId: string;
      /**
       * Trace's actual occurredAt (ms). Forwarded to the URL as `drawer.t`
       * so per-trace queries use the same cache key as the prefetch — without
       * this, jumping between siblings creates a fresh key each time and
       * re-fetches even when the data is already in the cache.
       */
      toTimestamp?: number;
      toViewMode?: DrawerViewMode;
    }) => {
      if (
        fromTraceId === toTraceId &&
        (toViewMode == null || toViewMode === fromViewMode)
      ) {
        return;
      }
      pushTraceHistory({ traceId: fromTraceId, viewMode: fromViewMode });
      if (toViewMode) setViewMode(toViewMode);
      // Push into the store immediately so drawer hooks render with the
      // right traceId/occurredAtMs before the URL change settles.
      useDrawerStore
        .getState()
        .openTrace(toTraceId, toTimestamp ?? null);
      openDrawer("traceV2Details", {
        traceId: toTraceId,
        ...(toTimestamp !== undefined ? { t: String(toTimestamp) } : {}),
      });
    },
    [openDrawer, pushTraceHistory, setViewMode],
  );

  const goBack = useCallback(() => {
    const previous = popTraceHistory();
    if (!previous) return;
    setViewMode(previous.viewMode);
    useDrawerStore.getState().openTrace(previous.traceId);
    openDrawer("traceV2Details", { traceId: previous.traceId });
  }, [openDrawer, popTraceHistory, setViewMode]);

  return {
    navigateToTrace,
    goBack,
    canGoBack: traceBackStack.length > 0,
    backStackDepth: traceBackStack.length,
  };
}
