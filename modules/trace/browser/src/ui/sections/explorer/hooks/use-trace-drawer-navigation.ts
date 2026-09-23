import { useCallback } from "react";

import {
  type DrawerViewMode,
  type TraceHistoryEntry,
  useDrawerStore,
} from "../../../../behavior/drawer.store.ts";
import { useDrawer } from "../../../../behavior/use-drawer.ts";
import { guardTraceEditExit } from "../utils/trace-edit-mode.ts";

type OpenDrawer = ReturnType<typeof useDrawer>["openDrawer"];

function traceDrawerParams({
  traceId,
  occurredAtMs,
}: {
  traceId: string;
  occurredAtMs: number | undefined;
}) {
  return {
    traceId,
    ...(occurredAtMs !== undefined ? { t: String(occurredAtMs) } : {}),
  };
}

function reopenHistoryEntry({
  entry,
  setViewMode,
  openDrawer,
}: {
  entry: TraceHistoryEntry;
  setViewMode: (mode: DrawerViewMode) => void;
  openDrawer: OpenDrawer;
}): void {
  setViewMode(entry.viewMode);
  useDrawerStore.getState().openTrace(entry.traceId, entry.occurredAtMs ?? null);
  openDrawer(
    "traceV2Details",
    traceDrawerParams({ traceId: entry.traceId, occurredAtMs: entry.occurredAtMs }),
  );
}

function applyTargetViewMode({
  toViewMode,
  persistViewMode,
  setViewMode,
}: {
  toViewMode: DrawerViewMode | undefined;
  persistViewMode: boolean;
  setViewMode: (mode: DrawerViewMode) => void;
}): void {
  if (!toViewMode) return;
  if (persistViewMode) setViewMode(toViewMode);
  else useDrawerStore.getState().setViewModeTransient(toViewMode);
}

/**
 * Trace-to-trace navigation inside the v2 drawer with a back stack.
 */
export function useTraceDrawerNavigation() {
  const { openDrawer } = useDrawer();
  const pushTraceHistory = useDrawerStore((s) => s.pushTraceHistory);
  const popTraceHistory = useDrawerStore((s) => s.popTraceHistory);
  const popTraceHistoryTo = useDrawerStore((s) => s.popTraceHistoryTo);
  const setViewMode = useDrawerStore((s) => s.setViewMode);
  const traceBackStack = useDrawerStore((s) => s.traceBackStack);

  const navigateToTrace = useCallback(
    ({
      fromTraceId,
      fromViewMode,
      fromTimestamp,
      toTraceId,
      toTimestamp,
      toViewMode,
      persistViewMode = true,
    }: {
      fromTraceId: string;
      fromViewMode: DrawerViewMode;
      /**
       * The trace we're navigating *away from* — its occurredAt is captured
       * onto the back stack so a future `goBack` can forward the partition-
       * pruning hint to drawer queries (header / spanTree / evals).
       */
      fromTimestamp?: number;
      toTraceId: string;
      /**
       * Trace's actual occurredAt (ms).
       */
      toTimestamp?: number;
      toViewMode?: DrawerViewMode;
      /**
       * When false, apply `toViewMode` for this navigation only without
       * persisting it as the remembered default — e.g. peeking at a
       * conversation turn's Summary shouldn't make Summary the user's tab.
       */
      persistViewMode?: boolean;
    }) => {
      if (fromTraceId === toTraceId && (toViewMode == null || toViewMode === fromViewMode)) {
        return;
      }
      // Moving to another trace leaves the correction behind, so an unsaved
      // one asks first and the navigation waits on the answer.
      guardTraceEditExit(() => {
        pushTraceHistory({
          traceId: fromTraceId,
          viewMode: fromViewMode,
          occurredAtMs: fromTimestamp,
        });
        applyTargetViewMode({ toViewMode, persistViewMode, setViewMode });
        // Push into the store immediately so drawer hooks render with the
        // right traceId/occurredAtMs before the URL change settles.
        useDrawerStore.getState().openTrace(toTraceId, toTimestamp ?? null);
        openDrawer(
          "traceV2Details",
          traceDrawerParams({ traceId: toTraceId, occurredAtMs: toTimestamp }),
        );
      });
    },
    [openDrawer, pushTraceHistory, setViewMode],
  );

  // Going back is going to another trace, so it asks about an unsaved
  // correction the same way going forward does. The history is popped inside
  // the guarded action: parking the exit and popping anyway would lose the
  // entry when the reviewer chooses to keep editing.
  const goBack = useCallback(() => {
    guardTraceEditExit(() => {
      const previous = popTraceHistory();
      if (!previous) return;
      reopenHistoryEntry({ entry: previous, setViewMode, openDrawer });
    });
  }, [openDrawer, popTraceHistory, setViewMode]);

  const goBackTo = useCallback(
    (index: number) => {
      guardTraceEditExit(() => {
        const target = popTraceHistoryTo(index);
        if (!target) return;
        reopenHistoryEntry({ entry: target, setViewMode, openDrawer });
      });
    },
    [openDrawer, popTraceHistoryTo, setViewMode],
  );

  return {
    navigateToTrace,
    goBack,
    goBackTo,
    canGoBack: traceBackStack.length > 0,
    backStackDepth: traceBackStack.length,
    backStack: traceBackStack,
  };
}
