import { LANGY_CONVERSATION_PARAM, supersedesConversationLink } from "@langwatch/langy-contract";
import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router";

import { api } from "./langy-api.ts";
import { useLangyStore } from "./langy.store.ts";
import { useOrganizationTeamProject } from "./use-organization-team-project.ts";

/**
 * Opens the panel on the conversation named by `?langyConversation=<id>`. Read through
 * `langy.detail`, which answers null both for missing and belonging-to-someone-else on purpose.
 * Mounted once per project, in ProjectLangyLayout. Spec: specs/langy/langy-local-control.feature.
 */
export function useLangyConversationDeepLink(): void {
  const location = useLocation();
  const navigate = useNavigate();
  const searchParams = new URLSearchParams(location.search);
  const { project } = useOrganizationTeamProject({
    redirectToOnboarding: false,
    redirectToProjectOnboarding: false,
  });
  // A question link beside it supersedes it: useLangyPromptLink opens a new conversation.
  const isSuperseded = supersedesConversationLink({ search: searchParams.toString() });
  const conversationId = isSuperseded ? null : searchParams.get(LANGY_CONVERSATION_PARAM);

  const detail = api.langy.detail.useQuery(
    {
      projectId: project?.id ?? "",
      conversationId: conversationId ?? "",
    },
    {
      enabled: !!project?.id && !!conversationId,
      retry: false,
      refetchOnWindowFocus: false,
    },
  );

  const settled = detail.isSuccess || detail.isError;
  const isVisible = detail.isSuccess && detail.data !== null;

  useEffect(() => {
    if (!conversationId) return;
    // Wait for the project to resolve and the read to answer; the effect
    // re-runs and strips once it does.
    if (!project?.id || !settled) return;

    if (isVisible) {
      useLangyStore.getState().openPanel();
      useLangyStore.getState().selectConversation(conversationId);
    }

    // Keeps the hash: the Trace Explorer holds its query there.
    const next = new URLSearchParams(location.search);
    next.delete(LANGY_CONVERSATION_PARAM);
    const rest = next.toString();
    void navigate(
      { pathname: location.pathname, search: rest ? `?${rest}` : "", hash: location.hash },
      { replace: true },
    );
  }, [
    conversationId,
    project?.id,
    settled,
    isVisible,
    navigate,
    location.pathname,
    location.search,
    location.hash,
  ]);
}
