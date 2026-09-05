import { useEffect } from "react";
import { useOrganizationTeamProject } from "../../../behavior/use-organization-team-project";
import { useRequiredSession } from "../../../behavior/auth-session";
import { useLangyStore } from "../../../index";

/**
 * Tell Langy which scope it is in, so nothing follows the user out of it.
 * Spec: specs/langy/langy-context-awareness.feature
 */
export function useLangyScopeReset(): void {
  const { data: session } = useRequiredSession();
  const { organization, project } = useOrganizationTeamProject({
    redirectToOnboarding: false,
    redirectToProjectOnboarding: false,
  });

  const userId = session?.user?.id;
  const organizationId = organization?.id;
  const projectId = project?.id;

  useEffect(() => {
    if (!userId || !organizationId || !projectId) return;
    useLangyStore.getState().resetForScope({
      userId,
      organizationId,
      projectId,
    });
  }, [userId, organizationId, projectId]);
}
