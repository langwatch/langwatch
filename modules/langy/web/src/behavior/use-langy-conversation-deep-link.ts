import { useEffect } from "react";
import { useSearchParams } from "react-router";
import { useOrganizationTeamProject } from "./use-organization-team-project.ts";
import { api } from "./langy-api.ts";
import { LANGY_CONVERSATION_PARAM } from "@langwatch/langy-contract";
import { useLangyStore } from "./langy.store.ts";

/**
 * Opens the panel on the conversation named by `?langyConversation=<id>`. Read through
 * `langy.detail`, which answers null both for missing and belonging-to-someone-else on purpose.
 * Mounted once per project, in ProjectLangyLayout. Spec: specs/langy/langy-local-control.feature.
 */
export function useLangyConversationDeepLink(): void {
  const [searchParams, setSearchParams] = useSearchParams();
  const { project } = useOrganizationTeamProject({
    redirectToOnboarding: false,
    redirectToProjectOnboarding: false,
  });
  const conversationId = searchParams.get(LANGY_CONVERSATION_PARAM);

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

    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete(LANGY_CONVERSATION_PARAM);
        return next;
      },
      { replace: true },
    );
  }, [conversationId, project?.id, settled, isVisible, setSearchParams]);
}
