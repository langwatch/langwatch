import { useDrawer } from "@langwatch/browser-host/use-drawer";
import { useCallback } from "react";

import { drawerChrome } from "../../../../behavior/drawer-chrome.store.ts";
import { getTraceDrawer, useTraceDrawer } from "../../../../behavior/trace-drawer.ts";
import { type DrawerViewMode, TRACE_DRAWER_NAME } from "../../../../model/trace-drawer-params.ts";
import { guardTraceEditExit } from "../utils/trace-edit-mode.ts";

/**
 * Trace-to-trace navigation inside the v2 drawer. Each trace the reader leaves
 * stays beneath the open one in the drawer stack, so Back, the back button and
 * a reload all agree on where they came from.
 */
export function useTraceDrawerNavigation() {
  const { openDrawer, goBack: goBackInStack, goBackTo: goBackToInStack, backStack } = useDrawer();
  const traceBackStack = useTraceDrawer((s) => s.traceBackStack);

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
       * The trace we're navigating *away from* — its occurredAt rides on the stack
       * entry so going back can forward the partition-pruning hint to drawer queries.
       */
      fromTimestamp?: number;
      toTraceId: string;
      /** Trace's actual occurredAt (ms). */
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
        const leaving = getTraceDrawer();
        // The entry the trace becomes records the view it was left on.
        leaving.setViewModeTransient(fromViewMode);
        if (fromTimestamp !== undefined) leaving.backfillOccurredAtMs(fromTimestamp);
        if (toViewMode && persistViewMode) drawerChrome.getState().rememberViewMode(toViewMode);
        openDrawer(
          TRACE_DRAWER_NAME,
          {
            traceId: toTraceId,
            ...(toTimestamp !== undefined ? { t: String(toTimestamp) } : {}),
            ...(leaving.projectId !== null ? { projectId: leaving.projectId } : {}),
            mode: toViewMode ?? fromViewMode,
            viz: leaving.vizTab,
          },
          { replace: false },
        );
      });
    },
    [openDrawer],
  );

  // Going back is going to another trace, so it asks about an unsaved
  // correction the same way going forward does. The stack is only walked inside
  // the guarded action: parking the exit and walking anyway would lose the
  // entry when the reviewer chooses to keep editing.
  const goBack = useCallback(() => {
    guardTraceEditExit(() => {
      const previous = traceBackStack[traceBackStack.length - 1];
      if (!previous) return;
      drawerChrome.getState().rememberViewMode(previous.viewMode);
      goBackInStack();
    });
  }, [goBackInStack, traceBackStack]);

  // The trace run sits at the top of the stack, so an index into it is an index
  // into the stack shifted by whatever drawers lie beneath the run.
  const goBackTo = useCallback(
    (index: number) => {
      guardTraceEditExit(() => {
        const target = traceBackStack[index];
        if (!target) return;
        drawerChrome.getState().rememberViewMode(target.viewMode);
        goBackToInStack(backStack.length - traceBackStack.length + index);
      });
    },
    [backStack.length, goBackToInStack, traceBackStack],
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
