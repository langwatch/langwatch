import { findLangyPromptLink, withoutLangyPromptLink } from "@langwatch/langy-contract";
import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router";

import { useLangyStore } from "./langy.store.ts";
import { useOrganizationTeamProject } from "./use-organization-team-project.ts";

/**
 * Applies `?langy=open&langyPrompt=<text>` once, then drops both and keeps the hash (the Explorer's
 * query). Waits for the scope reset, which would otherwise wipe the typed question.
 * Spec: specs/langy/langy-prompt-link.feature
 */
export function useLangyPromptLink(): void {
  const location = useLocation();
  const navigate = useNavigate();
  const { project } = useOrganizationTeamProject({
    redirectToOnboarding: false,
    redirectToProjectOnboarding: false,
  });
  const scopedProjectId = useLangyStore((s) => {
    const scope = s.activeConversationScope;
    if (!s.scopeAnnounced || !scope?.userId || !scope.organizationId) return null;
    return scope.projectId;
  });
  const [link] = findLangyPromptLink({ search: location.search });
  const prompt = link?.prompt;
  const isReady = !!project?.id && scopedProjectId === project.id;

  useEffect(() => {
    if (prompt === undefined || !isReady) return;
    useLangyStore.getState().openFromLink(prompt);
    void navigate(
      {
        pathname: location.pathname,
        search: withoutLangyPromptLink({ search: location.search }),
        hash: location.hash,
      },
      { replace: true },
    );
  }, [prompt, isReady, navigate, location.pathname, location.search, location.hash]);
}
