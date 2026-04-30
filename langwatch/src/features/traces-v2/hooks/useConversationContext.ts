import { useMemo } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { isPreviewTraceId } from "../components/EmptyState/samplePreviewTraces";
import type { TraceListItem } from "../types/trace";

export interface ConversationTurn {
  traceId: string;
  timestamp: number;
  name: string;
  rootSpanType: string | null;
  status: TraceListItem["status"];
  input: string | null;
  output: string | null;
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
  const { project } = useOrganizationTeamProject();

  // Conversation context for preview-mode traces is seeded
  // directly into the cache by `useOpenTraceDrawer`. We disable
  // the *fetch* (so a real network call doesn't clobber the seed
  // with an empty result) but still consume cached data through
  // the same `useQuery` instance — `enabled: false` doesn't blank
  // the cache; we just have to be careful not to short-circuit
  // *before* reading `query.data` below.
  const isPreview = !!traceId && isPreviewTraceId(traceId);
  const fetchEnabled =
    !!project?.id && !!conversationId && !isPreview;

  const query = api.tracesV2.conversationContext.useQuery(
    {
      projectId: project?.id ?? "",
      conversationId: conversationId ?? "",
    },
    {
      enabled: fetchEnabled,
      staleTime: 30_000,
      cacheTime: 1_800_000,
      keepPreviousData: true,
      refetchOnWindowFocus: false,
    },
  );

  return useMemo<ConversationContextResult>(() => {
    if (!project?.id || !conversationId) return NULL_RESULT;
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
      next:
        idx >= 0 && idx < turns.length - 1 ? (turns[idx + 1] ?? null) : null,
      isLoading: false,
    };
  }, [project?.id, query.data, query.isLoading, conversationId, traceId]);
}
