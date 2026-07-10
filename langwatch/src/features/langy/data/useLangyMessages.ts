import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import type { LangyMessageDto } from "./langy.dtos";

export interface LangyMessagesResult {
  messages: LangyMessageDto[];
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
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
  };
}
