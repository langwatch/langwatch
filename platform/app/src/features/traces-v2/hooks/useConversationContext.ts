import { keepPreviousData } from "@tanstack/react-query";
import { useMemo } from "react";
import { api } from "~/utils/api";
import { useSharedTrace } from "../context/SharedTraceContext";
import { isPreviewTraceId } from "@langwatch/trace-web";
import type { TraceListItem } from "../types/trace";
import { useDrawerProjectId } from "./useDrawerProjectId";

export interface ConversationTurn {
  traceId: string;
  timestamp: number;
  name: string;
  rootSpanType: string | null;
  status: TraceListItem["status"];
  input: string | null;
  output: string | null;
  /**
   * Set when a restrict privacy rule hid the turn's content from this viewer
   * (the server nulled `input`/`output`). Lets the strip render a "Redacted"
   * marker instead of a "(no message)" placeholder that reads as truly absent.
   */
  inputRedacted?: boolean | null;
  outputRedacted?: boolean | null;
  inputVisibleTo?: string | null;
  outputVisibleTo?: string | null;
  /**
   * The turn's own totals, so the terminal view can count the session's turns
   * above its loaded window without reading their transcripts. Optional
   * because a cached response from before the fields existed may not carry
   * them.
   */
  totalTokens?: number | null;
  totalCost?: number | null;
}

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
 * `tracesV2.conversationContext` endpoint, which builds a typed WHERE
 * fragment server-side (no liqe parsing fragility around weird
 * conversationId chars).
 *
 * The query is keyed only on (projectId, conversationId) so arrow-key
 * navigation between sibling traces doesn't churn the cache — `position`,
 * `previous`, and `next` are derived locally from the active `traceId`.
 */
export function useConversationContext(
  conversationId: string | null | undefined,
  traceId: string | null | undefined,
): ConversationContextResult {
  const projectId = useDrawerProjectId();
  const shared = useSharedTrace();

  // Conversation context for preview-mode traces is seeded
  // directly into the cache by `useOpenTraceDrawer`. We disable
  // the *fetch* (so a real network call doesn't clobber the seed
  // with an empty result) but still consume cached data through
  // the same `useQuery` instance — `enabled: false` doesn't blank
  // the cache; we just have to be careful not to short-circuit
  // *before* reading `query.data` below.
  // The read-only share page carries no conversation payload (thread sharing
  // is a follow-up), so it never fetches the surrounding conversation.
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
