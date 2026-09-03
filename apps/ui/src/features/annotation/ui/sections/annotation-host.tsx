/**
 * What the annotations screen is mounted inside.
 *
 * Two things go around `/:project/annotations` and its three sibling addresses:
 * the tRPC Provider the package's own hooks run on, and the host port that
 * answers for the project, the reviewer, their grants and membership, whether
 * this is their own personal workspace, the address and the feedback. Both are
 * mounted here, once, so a screen module stays a screen module.
 *
 * `organization.getAll` is asked with the same input the application shell asks
 * with, which under tRPC's path-plus-input cache key is the same entry: the
 * graph is fetched once for the document however many halves of the product
 * want it. This family reads it for two answers — which project the address is
 * about, and whether the TEAM that project sits on is the reviewer's own
 * personal one.
 */

import {
  annotationApi,
  AnnotationHostProvider,
  type AnnotationHostPort,
} from "@langwatch/annotation-web/screens/annotations";
import { useMemo, type ReactNode } from "react";
import { useUiCapabilities } from "../../../../behavior/ui-capabilities";
import { useUiOrganizationFacts } from "../../../../behavior/ui-organization-facts";
import { presentAnnotationSuccess } from "../../behavior/annotation-success-notice";

export function AnnotationHost({ children }: { children: ReactNode }) {
  const { session, navigation, route, feedback } = useUiCapabilities();
  const scope = session.activeScope();
  const { isLiteMember } = useUiOrganizationFacts();

  const organizations = annotationApi.organization.getAll.useQuery({ isDemo: false });

  const actor = session.currentUser();

  /**
   * The project the address is about, and the team it sits on.
   *
   * Resolved from the one graph read rather than from a second query. Without a
   * project in scope the screen renders its empty shell, which is what the
   * platform pages did: every annotation belongs to a project.
   */
  const placement = useMemo(() => {
    if (!scope.projectId) return void 0;
    for (const organization of organizations.data ?? []) {
      for (const team of organization.teams) {
        const found = team.projects.find((candidate) => candidate.id === scope.projectId);
        if (found) {
          return {
            project: { id: found.id, slug: found.slug, name: found.name },
            team,
          };
        }
      }
    }
    return void 0;
  }, [organizations.data, scope.projectId]);

  // The advanced-features bundle exists only on a reviewer's OWN personal
  // workspace, and `personalWorkspaceFeatures.get` answers NOT_FOUND for
  // anybody else's — so this is what decides whether the dataset hand-off asks
  // before it opens, and asking the procedure instead would mean reading a
  // refusal as an answer.
  const isOwnPersonalWorkspace =
    !!placement?.team.isPersonal && placement.team.ownerUserId === actor?.id;

  const reading = route.reading();
  const host = useMemo<AnnotationHostPort>(
    () => ({
      project: () => placement?.project,
      organizationId: () => scope.organizationId ?? void 0,
      currentUser: () => (actor ? { id: actor.id, name: actor.name, image: actor.image } : void 0),
      hasPermission: (permission) => session.hasPermission(permission),
      isLiteMember: () => isLiteMember,
      isOwnPersonalWorkspace: () => isOwnPersonalWorkspace,
      route: () => reading,
      setQuery: (next, options) => route.setQuery(next, options),
      navigate: (to) => navigation.navigate(to),
      succeeded: (notice) =>
        presentAnnotationSuccess({ notice, succeeded: (n) => feedback.succeeded(n) }),
      failed: (failure) => feedback.failed(failure),
    }),
    [
      placement,
      scope.organizationId,
      actor,
      session,
      isLiteMember,
      isOwnPersonalWorkspace,
      reading,
      route,
      navigation,
      feedback,
    ],
  );

  return <AnnotationHostProvider value={host}>{children}</AnnotationHostProvider>;
}
