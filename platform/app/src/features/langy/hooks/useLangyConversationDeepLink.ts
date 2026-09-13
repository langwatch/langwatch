import { useEffect } from "react";
import { useSearchParams } from "react-router";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { LANGY_CONVERSATION_PARAM } from "../logic/langyConversationDeepLink";
import { useLangyStore } from "../stores/langyStore";

/**
 * Open the panel on the conversation named by `?langyConversation=<id>`.
 *
 * The command line prints that link when a folder is shared and again on every
 * permission ask, and nothing read it: the link opened the project home with
 * whatever conversation the panel already had.
 *
 * The conversation is read through `langy.detail`, which answers null for one
 * this reader cannot see — missing and belonging-to-someone-else share that
 * answer on purpose, so a link cannot be used to learn that a conversation
 * exists. Either way the parameter is stripped, so a stale or hostile id
 * neither lingers in the address bar nor re-runs this.
 *
 * Mounted once per project, in ProjectLangyLayout.
 *
 * Spec: specs/langy/langy-local-control.feature.
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
