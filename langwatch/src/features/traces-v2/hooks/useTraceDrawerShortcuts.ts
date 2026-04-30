import { useEffect } from "react";
import type {
  SpanTreeNode,
  TraceHeader,
} from "~/server/api/routers/tracesV2.schemas";
import { useDrawerStore } from "../stores/drawerStore";
import type { ConversationContextResult } from "./useConversationContext";
import type { useTraceDrawerNavigation } from "./useTraceDrawerNavigation";
import {
  type ShortcutContext,
  TRACE_DRAWER_SHORTCUTS,
} from "./traceDrawerShortcutTable";

interface ShortcutsParams {
  trace: TraceHeader | null;
  spanTree: SpanTreeNode[];
  conversationContext: ConversationContextResult;
  navigateToTrace: ReturnType<typeof useTraceDrawerNavigation>["navigateToTrace"];
  goBack: () => void;
  canGoBack: boolean;
  refreshActiveTrace: () => Promise<void> | void;
  onClose: () => void;
}

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return (
    el.tagName === "INPUT" ||
    el.tagName === "TEXTAREA" ||
    el.isContentEditable
  );
}

/**
 * Single keydown listener for the trace drawer. Reads mutable UI state
 * directly from `drawerStore.getState()` inside the handler so the effect
 * dep list stays small — the listener is registered once per `trace` and
 * stays stable for the trace's lifetime. Shortcuts are defined in
 * `traceDrawerShortcutTable.ts` so the help dialog and dispatcher share
 * one source.
 */
export function useTraceDrawerShortcuts({
  trace,
  spanTree,
  conversationContext,
  navigateToTrace,
  goBack,
  canGoBack,
  refreshActiveTrace,
  onClose,
}: ShortcutsParams) {
  const nextTraceId = conversationContext.next?.traceId ?? null;
  const nextTimestamp = conversationContext.next?.timestamp;
  const prevTraceId = conversationContext.previous?.traceId ?? null;
  const prevTimestamp = conversationContext.previous?.timestamp;

  useEffect(() => {
    if (!trace) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      // Don't hijack OS chords (Cmd+C / Ctrl+T / Alt+...).
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const entry = TRACE_DRAWER_SHORTCUTS.find((s) =>
        s.matchKeys.includes(e.key),
      );
      if (!entry) return;

      const store = useDrawerStore.getState();
      const ctx: ShortcutContext = {
        event: e,
        store,
        trace,
        spanTree,
        nextTraceId,
        nextTimestamp,
        prevTraceId,
        prevTimestamp,
        navigateToTrace,
        goBack,
        canGoBack,
        refreshActiveTrace,
        onClose,
      };

      if (entry.guard && !entry.guard(ctx)) return;
      e.preventDefault();
      entry.run(ctx);
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [
    trace,
    spanTree,
    nextTraceId,
    nextTimestamp,
    prevTraceId,
    prevTimestamp,
    navigateToTrace,
    goBack,
    canGoBack,
    refreshActiveTrace,
    onClose,
  ]);
}
