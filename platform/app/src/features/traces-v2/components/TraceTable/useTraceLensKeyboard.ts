import type React from "react";
import { useCallback, useState } from "react";
import { useDrawer, useDrawerParams } from "~/hooks/useDrawer";
import { useOpenTraceDrawer } from "../../hooks/useOpenTraceDrawer";
import type { TraceListItem } from "../../types/trace";

interface TraceLensKeyboard {
  selectedTraceId: string | null;
  focusedIndex: number;
  expandedTraceId: string | null;
  toggleTrace: (trace: TraceListItem) => void;
  togglePeek: (traceId: string) => void;
  handleKeyDown: (e: React.KeyboardEvent) => void;
}

export function useTraceLensKeyboard({
  traces,
}: {
  traces: TraceListItem[];
}): TraceLensKeyboard {
  const { closeDrawer, currentDrawer } = useDrawer();
  const params = useDrawerParams();
  const openTraceDrawer = useOpenTraceDrawer();
  const selectedTraceId =
    currentDrawer === "traceV2Details" ? (params.traceId ?? null) : null;

  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [expandedTraceId, setExpandedTraceId] = useState<string | null>(null);

  const toggleTrace = useCallback(
    (trace: TraceListItem) => {
      if (selectedTraceId === trace.traceId) {
        closeDrawer();
      } else {
        openTraceDrawer(trace);
      }
    },
    [selectedTraceId, closeDrawer, openTraceDrawer],
  );

  const togglePeek = useCallback(
    (traceId: string) =>
      setExpandedTraceId((prev) => (prev === traceId ? null : traceId)),
    [],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusedIndex((i) => Math.min(i + 1, traces.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusedIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Escape") {
        closeDrawer();
        return;
      }
      const focused = traces[focusedIndex];
      if (!focused) return;
      if (e.key === "Enter") toggleTrace(focused);
      else if (e.key === "p") togglePeek(focused.traceId);
    },
    [traces, focusedIndex, toggleTrace, togglePeek, closeDrawer],
  );

  return {
    selectedTraceId,
    focusedIndex,
    expandedTraceId,
    toggleTrace,
    togglePeek,
    handleKeyDown,
  };
}
