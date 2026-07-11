import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import type { LangyMessageDto } from "./langy.dtos";

export interface LangyMessagesResult {
  messages: LangyMessageDto[];
  /**
   * The last turn's failure, serialized (a domain-error kind + safe meta, never
   * raw text) — or null if it didn't fail.
   *
   * Turn errors used to live ONLY in `useChat`'s state, so a refresh after a
   * failed turn left the user's question sitting there with no answer and no
   * explanation. The failure was durable on the conversation fold the whole
   * time; nobody read it back. Now the history load carries it, and the panel
   * renders the same card it would have shown live.
   */
  lastError: string | null;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
}

/**
 * HEAVY, on-demand message history for one conversation (`langy.messages`).
 * Deliberately split from the slim list: opening a conversation reads its
 * messages here, and the recents list is never re-fetched to obtain them (and
 * never carries content). Disabled until a conversation is selected.
 */
export function useLangyMessages(
  conversationId: string | null,
): LangyMessagesResult {
  const { project } = useOrganizationTeamProject();

  const query = api.langy.messages.useQuery(
    {
      projectId: project?.id ?? "",
      conversationId: conversationId ?? "",
    },
    {
      enabled: !!project?.id && !!conversationId,
      staleTime: 30_000,
      keepPreviousData: true,
    },
  );

  return {
    messages: (query.data?.messages ?? []) as LangyMessageDto[],
    lastError: query.data?.lastError ?? null,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
  };
}
