import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import type { LangyConversationDetailDto } from "./langy.dtos";

export interface LangyConversationDetailResult {
  detail: LangyConversationDetailDto | null;
  isLoading: boolean;
  isFetching: boolean;
}

/**
 * Single-conversation spine (status + counts) for the open conversation.
 * Split from the message read so lifecycle status can refresh (via the
 * freshness signal) independently of the — heavier — message history.
 */
export function useLangyConversationDetail(
  conversationId: string | null,
): LangyConversationDetailResult {
  const { project } = useOrganizationTeamProject();

  const query = api.langy.detail.useQuery(
    {
      projectId: project?.id ?? "",
      conversationId: conversationId ?? "",
    },
    {
      enabled: !!project?.id && !!conversationId,
      staleTime: 15_000,
      keepPreviousData: true,
    },
  );

  return {
    detail: (query.data ?? null) as LangyConversationDetailDto | null,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
  };
}
