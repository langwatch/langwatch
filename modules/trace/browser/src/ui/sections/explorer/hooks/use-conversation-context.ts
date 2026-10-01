import { keepPreviousData } from "@tanstack/react-query";
import { useMemo } from "react";

import { api } from "../../../../behavior/trace-api.ts";
import type { ConversationTurn } from "../../../../model/explorer/conversation-turn.ts";
import { isPreviewTraceId } from "../../../../model/preview-trace-id.ts";
import { useIsReadOnlyTrace } from "../../../elements/explorer/context/trace-viewer-context.tsx";
import { useDrawerProjectId } from "./use-drawer-project-id.ts";

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
 * `traces.conversationContext` endpoint, which builds a typed WHERE fragment
 * server-side (no liqe parsing fragility around weird conversationId chars).
 */
export function useConversationContext(
  conversationId: string | null | undefined,
  traceId: string | null | undefined,
): ConversationContextResult {
  const projectId = useDrawerProjectId();
  const isReadOnly = useIsReadOnlyTrace();

  // Conversation context for preview-mode traces is seeded directly into the cache by
  // `useOpenTraceDrawer`.
  const isPreview = !!traceId && isPreviewTraceId(traceId);
  const fetchEnabled = !!projectId && !!conversationId && !isPreview && !isReadOnly;

  const query = api.traces.conversationContext.useQuery(
    {
      projectId,
      conversationId: conversationId ?? "",
    },
    {
      enabled: fetchEnabled,
      gcTime: 1_800_000,
      placeholderData: keepPreviousData,
    },
  );

  return useMemo<ConversationContextResult>(
    () =>
      conversationContextResult({
        conversationId: conversationId ?? null,
        data: query.data,
        isLoading: query.isLoading,
        projectId,
        traceId: traceId ?? null,
      }),
    [projectId, query.data, query.isLoading, conversationId, traceId],
  );
}

type ConversationContextData = { conversationId: string; total: number; turns: ConversationTurn[] };

/** The conversation result for one render: no data, no context, or the located turn. */
function conversationContextResult({
  conversationId,
  data,
  isLoading,
  projectId,
  traceId,
}: {
  conversationId: string | null;
  data: ConversationContextData | undefined;
  isLoading: boolean;
  projectId: string;
  traceId: string | null;
}): ConversationContextResult {
  if (!projectId || !conversationId) return NULL_RESULT;
  if (!data) return { ...NULL_RESULT, conversationId, isLoading };

  const turns = data.turns;
  const idx = traceId ? turns.findIndex((t) => t.traceId === traceId) : -1;
  return {
    conversationId: data.conversationId,
    turns,
    total: data.total,
    position: idx === -1 ? 0 : idx + 1,
    previous: idx > 0 ? (turns[idx - 1] ?? null) : null,
    next: idx >= 0 && idx < turns.length - 1 ? (turns[idx + 1] ?? null) : null,
    isLoading: false,
  };
}
