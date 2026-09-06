import { useEffect } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useRequiredSession } from "~/hooks/useRequiredSession";
import { useLangyStore } from "../stores/langyStore";

/**
 * Tell Langy which scope it is in, so nothing follows the user out of it.
 *
 * Every Langy store is a module singleton — that is deliberate (the panel, the
 * draft and an in-flight answer all have to survive navigating between pages),
 * and it is exactly why the boundary has to be announced. Nothing about a
 * conversation, a draft, a picked trace row, a model override or the developer
 * tape is meaningful anywhere but the scope it was made in, and "somewhere else"
 * is three different moves, not one:
 *
 *   PROJECT — the obvious one, and the only one the panel used to watch.
 *   ORGANIZATION — a different set of projects, people and data entirely.
 *   USER — the one that hides, because the project id can be IDENTICAL across
 *     it. A shared machine, a second account, an impersonation session: same
 *     project, different person, and by the project id alone nothing moved.
 *
 * Announce all three and the store does the rest (`resetForScope`), including
 * restoring the conversation when the scope turns out to be the one we left —
 * which is what makes a page refresh put the user back where they were instead
 * of wiping them.
 *
 * DELIBERATELY SILENT UNTIL ALL THREE RESOLVE. They arrive asynchronously and
 * independently, and `useOrganizationTeamProject` briefly reports no project at
 * all while it refetches. Announcing a half-resolved scope would read as a
 * change, wipe the conversation, and then "change" back — so a partial answer is
 * treated as no answer. Sign-out needs no handling here: it is a full-page
 * navigation, which takes every one of these singletons with it.
 *
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
