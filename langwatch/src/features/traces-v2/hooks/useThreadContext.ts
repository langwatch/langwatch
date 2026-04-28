import { useMemo } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import type { TraceListItem } from "../types/trace";

export interface ThreadTurn {
  traceId: string;
  timestamp: number;
  name: string;
  rootSpanType: string | null;
  status: TraceListItem["status"];
  input: string | null;
  output: string | null;
}

interface ThreadContextResult {
  conversationId: string | null;
  total: number;
  position: number;
  turns: ThreadTurn[];
  previous: ThreadTurn | null;
  next: ThreadTurn | null;
  isLoading: boolean;
}

const NULL_RESULT: ThreadContextResult = {
  conversationId: null,
  total: 0,
  position: 0,
  turns: [],
  previous: null,
  next: null,
  isLoading: false,
};

/**
 * Conversation context for a trace inside a thread. Backed by the dedicated
 * `tracesV2.threadContext` endpoint, which builds a typed WHERE fragment
 * server-side (no liqe parsing fragility around weird conversationId chars).
 */
export function useThreadContext(
  conversationId: string | null | undefined,
  traceId: string | null | undefined,
): ThreadContextResult {
  const { project } = useOrganizationTeamProject();

  const enabled = !!project?.id && !!conversationId && !!traceId;

  const query = api.tracesV2.threadContext.useQuery(
    {
      projectId: project?.id ?? "",
      conversationId: conversationId ?? "",
      traceId: traceId ?? "",
    },
    {
      enabled,
      staleTime: 30_000,
      // Same conversation, same context — keep it warm so jumping in/out
      // of the drawer doesn't re-fetch the thread strip.
      gcTime: 1_800_000,
      // While the query refetches for the new traceId (the cache key changes
      // on every J/K press), keep showing the previous turns array. The
      // current/previous/next fields will lag by one render but the strip
      // doesn't blank out — eliminates the brief loading flash on rapid
      // sibling navigation.
      keepPreviousData: true,
      refetchOnWindowFocus: false,
    },
  );

  return useMemo<ThreadContextResult>(() => {
    if (!enabled) return NULL_RESULT;
    if (!query.data) {
      return {
        ...NULL_RESULT,
        conversationId: conversationId ?? null,
        isLoading: query.isLoading,
      };
    }
    return {
      conversationId: query.data.conversationId,
      turns: query.data.turns,
      total: query.data.total,
      position: query.data.position,
      previous: query.data.previous,
      next: query.data.next,
      isLoading: false,
    };
  }, [enabled, query.data, query.isLoading, conversationId]);
}
