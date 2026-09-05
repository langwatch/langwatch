import { keepPreviousData } from "@tanstack/react-query";
import { useMemo } from "react";
import { api } from "../../trace-api";
import { useIsReadOnlyTrace } from "../../../elements/explorer/context/trace-viewer-context";
import { useDrawerProjectId } from "./use-drawer-project-id";

const HOUR_MS = 60 * 60 * 1000;
const WINDOW_DAYS = 90;

/**
 * Time window for the conversation-turns query.
 */
export function conversationTurnsWindow(nowMs: number): {
  from: number;
  to: number;
} {
  const to = Math.ceil(nowMs / HOUR_MS) * HOUR_MS;
  return { from: to - WINDOW_DAYS * 24 * HOUR_MS, to };
}

/**
 * Query the trace list filtered down to one conversation, sorted oldest → newest. The
 * drawer's Conversation tab consumes the result as the turn sequence for the active
 * thread.
 */
export function useConversationTurns(conversationId: string | null) {
  const projectId = useDrawerProjectId();
  const isReadOnly = useIsReadOnlyTrace();

  const timeRange = useMemo(
    () => conversationTurnsWindow(Date.now()),
    // Recompute only when the target conversation or its project changes; the
    // hour-rounded window keeps the key stable across renders within the hour.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projectId, conversationId],
  );

  return api.tracesV2.list.useQuery(
    {
      projectId,
      timeRange,
      sort: { columnId: "time", direction: "asc" },
      page: 1,
      pageSize: 100,
      query: conversationId
        ? `conversation:"${conversationId.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
        : "",
    },
    {
      // Backed by `tracesV2.list`, which stays project-protected (it is the
      // traces-table query with arbitrary filters). A share grant must never
      // open it, so read-only viewers skip conversation turns entirely.
      enabled: !!projectId && !!conversationId && !isReadOnly,
      staleTime: 30_000,
      placeholderData: keepPreviousData,
    },
  );
}
