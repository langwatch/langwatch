import { keepPreviousData } from "@tanstack/react-query";
import { useMemo } from "react";
import { api } from "../../../../behavior/trace-api";
import { useSharedTrace } from "../context/shared-trace-context";
import { isPreviewTraceId } from "../../../../index";
import type { ConversationTurn } from "../../../../model/explorer/conversation-turn";
import type { TraceListItem } from "../types/trace";
import { useDrawerProjectId } from "./use-drawer-project-id";

export interface ConversationContextResult {
  conversationId: string | null;
  total: number;
  position: number;
  turns: ConversationTurn[];
  previous: ConversationTurn | null;
  next: ConversationTurn | null;
  isLoading: boolean;
}

const NULL_RESULT: ConversationContextResult = {
  conversationId: null,
  total: 0,
  position: 0,
  turns: [],
  previous: null,
  next: null,
  isLoading: false,
};

/**
 * Conversation context for a trace. Backed by the dedicated
 * `tracesV2.conversationContext` endpoint, which builds a typed WHERE fragment
 * server-side (no liqe parsing fragility around weird conversationId chars).
 */
export function useConversationContext(
  conversationId: string | null | undefined,
  traceId: string | null | undefined,
): ConversationContextResult {
  const projectId = useDrawerProjectId();
  const shared = useSharedTrace();

  // Conversation context for preview-mode traces is seeded directly into the cache by
  // `useOpenTraceDrawer`.
  const isPreview = !!traceId && isPreviewTraceId(traceId);
  const fetchEnabled = !!projectId && !!conversationId && !isPreview && !shared;

  const query = api.tracesV2.conversationContext.useQuery(
    {
      projectId,
      conversationId: conversationId ?? "",
    },
    {
      enabled: fetchEnabled,
      staleTime: 30_000,
      gcTime: 1_800_000,
      placeholderData: keepPreviousData,
      refetchOnWindowFocus: false,
    },
  );

  return useMemo<ConversationContextResult>(() => {
    if (shared) {
      return { ...NULL_RESULT, conversationId: conversationId ?? null };
    }
    if (!projectId || !conversationId) return NULL_RESULT;
    if (!query.data) {
      return {
        ...NULL_RESULT,
        conversationId: conversationId ?? null,
        isLoading: query.isLoading,
      };
    }
    const turns = query.data.turns;
    const idx = traceId ? turns.findIndex((t) => t.traceId === traceId) : -1;
    return {
      conversationId: query.data.conversationId,
      turns,
      total: query.data.total,
      position: idx === -1 ? 0 : idx + 1,
      previous: idx > 0 ? (turns[idx - 1] ?? null) : null,
      next: idx >= 0 && idx < turns.length - 1 ? (turns[idx + 1] ?? null) : null,
      isLoading: false,
    };
  }, [projectId, query.data, query.isLoading, conversationId, traceId, shared]);
}
