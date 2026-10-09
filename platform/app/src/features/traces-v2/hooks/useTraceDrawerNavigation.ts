import { useCallback } from "react";
import { useDrawer } from "~/hooks/useDrawer";
import {
  type DrawerViewMode,
  type TraceHistoryEntry,
  useDrawerStore,
} from "../stores/drawerStore";
import { traceDrawerParams } from "../utils/traceDrawerParams";
import { guardTraceEditExit } from "../utils/traceEditMode";

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
      toTenantId,
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
       * Trace's actual occurredAt (ms). Forwarded to the URL as `drawer.t`
       * so per-trace queries use the same cache key as the prefetch — without
       * this, jumping between siblings creates a fresh key each time and
       * re-fetches even when the data is already in the cache.
       */
      toTimestamp?: number;
      toViewMode?: DrawerViewMode;
      /**
       * The member that owns the trace navigated to, on an aggregate. Every
       * caller today walks a conversation's turns, which the conversation
       * read already keeps on one member, so it defaults to the member the
       * drawer is on; the trace navigated away from keeps its own on the
       * back stack.
       */
      toTenantId?: string | null;
      /**
       * When false, apply `toViewMode` for this navigation only without
       * persisting it as the remembered default — e.g. peeking at a
       * conversation turn's Summary shouldn't make Summary the user's tab.
       */
      persistViewMode?: boolean;
    }) => {
      if (
        fromTraceId === toTraceId &&
        (toViewMode == null || toViewMode === fromViewMode)
      ) {
        return;
      }
      // Moving to another trace leaves the correction behind, so an unsaved
      // one asks first and the navigation waits on the answer.
      guardTraceEditExit(() => {
        const fromTenantId = useDrawerStore.getState().tenantId;
        const tenantId = toTenantId === undefined ? fromTenantId : toTenantId;
        pushTraceHistory({
          traceId: fromTraceId,
          viewMode: fromViewMode,
          occurredAtMs: fromTimestamp,
          ...(fromTenantId !== null ? { tenantId: fromTenantId } : {}),
        });
        if (toViewMode) {
          if (persistViewMode) setViewMode(toViewMode);
          else useDrawerStore.getState().setViewModeTransient(toViewMode);
        }
        // Push into the store immediately so drawer hooks render with the
        // right traceId/occurredAtMs/member before the URL change settles.
        useDrawerStore
          .getState()
          .openTrace(toTraceId, toTimestamp ?? null, { tenantId });
        openDrawer(
          "traceV2Details",
          traceDrawerParams({
            traceId: toTraceId,
            occurredAtMs: toTimestamp,
            tenantId,
          }),
        );
      });
    },
    [openDrawer, pushTraceHistory, setViewMode],
  );

  /** Reopen a back-stack entry: its trace, its view mode, its member. */
  const reopenEntry = useCallback(
    (entry: TraceHistoryEntry) => {
      setViewMode(entry.viewMode);
      useDrawerStore
        .getState()
        .openTrace(entry.traceId, entry.occurredAtMs ?? null, {
          tenantId: entry.tenantId ?? null,
        });
      openDrawer(
        "traceV2Details",
        traceDrawerParams({
          traceId: entry.traceId,
          occurredAtMs: entry.occurredAtMs,
          tenantId: entry.tenantId,
        }),
      );
    },
    [openDrawer, setViewMode],
  );

  // Going back is going to another trace, so it asks about an unsaved
  // correction the same way going forward does. The history is popped inside
  // the guarded action: parking the exit and popping anyway would lose the
  // entry when the reviewer chooses to keep editing.
  const goBack = useCallback(() => {
    guardTraceEditExit(() => {
      const previous = popTraceHistory();
      if (!previous) return;
      reopenEntry(previous);
    });
  }, [popTraceHistory, reopenEntry]);

  const goBackTo = useCallback(
    (index: number) => {
      guardTraceEditExit(() => {
        const target = popTraceHistoryTo(index);
        if (!target) return;
        reopenEntry(target);
      });
    },
    [popTraceHistoryTo, reopenEntry],
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
