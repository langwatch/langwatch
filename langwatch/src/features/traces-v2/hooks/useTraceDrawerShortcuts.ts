import { type RefObject, useEffect } from "react";
import type {
  SpanTreeNode,
  TraceHeader,
} from "~/server/api/routers/tracesV2.schemas";
import { useDrawerStore } from "../stores/drawerStore";
import type { ConversationContextResult } from "./useConversationContext";
import type { useTraceDrawerNavigation } from "./useTraceDrawerNavigation";

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
 * stays stable for the trace's lifetime.
 *
 * Conventions
 * - Escape: closes the shortcuts dialog → clears the selected span → closes.
 * - `[` / `]`: prev / next span in the flat tree order.
 * - `1-5`: viz tab.
 * - `O`/`L`/`P`: lower tab bar (summary / LLM-optimized / prompts).
 * - `T`/`C`: drawer view mode (trace / conversation).
 * - Arrow Left/Right: conversation thread navigation.
 * - `B`: back through the in-drawer trace history stack.
 * - `M`: maximize toggle. `R`: refresh. `Y`: copy trace id.
 * - `?`: shortcuts dialog.
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

      const store = useDrawerStore.getState();

      switch (e.key) {
        case "Escape": {
          e.preventDefault();
          if (store.shortcutsOpen) {
            store.setShortcutsOpen(false);
          } else if (store.selectedSpanId) {
            store.clearSpan();
          } else {
            onClose();
          }
          return;
        }
        case "?": {
          e.preventDefault();
          store.setShortcutsOpen(!store.shortcutsOpen);
          return;
        }
        case "ArrowRight": {
          // Always claim — otherwise an end-of-thread press fell through to
          // browser nav.
          e.preventDefault();
          if (nextTraceId) {
            navigateToTrace({
              fromTraceId: trace.traceId,
              fromViewMode: store.viewMode,
              toTraceId: nextTraceId,
              toTimestamp: nextTimestamp,
            });
          }
          return;
        }
        case "ArrowLeft": {
          e.preventDefault();
          if (prevTraceId) {
            navigateToTrace({
              fromTraceId: trace.traceId,
              fromViewMode: store.viewMode,
              toTraceId: prevTraceId,
              toTimestamp: prevTimestamp,
            });
          }
          return;
        }
        case "]": {
          if (spanTree.length === 0) return;
          e.preventDefault();
          const idx = store.selectedSpanId
            ? spanTree.findIndex((s) => s.spanId === store.selectedSpanId)
            : -1;
          const next = spanTree[Math.min(idx + 1, spanTree.length - 1)];
          if (next) store.selectSpan(next.spanId);
          return;
        }
        case "[": {
          if (spanTree.length === 0) return;
          e.preventDefault();
          const idx = store.selectedSpanId
            ? spanTree.findIndex((s) => s.spanId === store.selectedSpanId)
            : 0;
          const prev = spanTree[Math.max(idx - 1, 0)];
          if (prev) store.selectSpan(prev.spanId);
          return;
        }
        case "b":
        case "B": {
          if (!canGoBack) return;
          e.preventDefault();
          goBack();
          return;
        }
        case "1":
          e.preventDefault();
          store.setVizTab("waterfall");
          return;
        case "2":
          e.preventDefault();
          store.setVizTab("flame");
          return;
        case "3":
          e.preventDefault();
          store.setVizTab("spanlist");
          return;
        case "4":
          e.preventDefault();
          store.setVizTab("topology");
          return;
        case "5":
          e.preventDefault();
          store.setVizTab("sequence");
          return;
        case "o":
        case "O": {
          // if (!store.selectedSpanId) return;
          e.preventDefault();
          store.setActiveTab("summary");
          return;
        }
        case "l":
        case "L": {
          e.preventDefault();
          store.setViewMode("trace");
          store.setActiveTab("llm");
          return;
        }
        case "p":
        case "P": {
          // Only available when the trace touched a managed prompt — same
          // gate as the tab visibility in SpanTabBar.
          const hasPrompt =
            trace.containsPrompt ||
            (trace.attributes["langwatch.prompt_ids"] ?? "").length > 0;
          if (!hasPrompt) return;
          e.preventDefault();
          store.setViewMode("trace");
          store.setActiveTab("prompts");
          return;
        }
        case "t":
        case "T":
          e.preventDefault();
          store.setViewMode("trace");
          return;
        case "c":
        case "C": {
          if (!trace.conversationId) return;
          e.preventDefault();
          store.setViewMode("conversation");
          return;
        }
        case "m":
        case "M":
          e.preventDefault();
          store.toggleMaximized();
          return;
        case "r":
        case "R":
          e.preventDefault();
          void refreshActiveTrace();
          return;
        case "y":
        case "Y":
          e.preventDefault();
          void navigator.clipboard.writeText(trace.traceId);
          return;
      }
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
