/**
 * What the annotations screen is mounted inside.
 *
 * Two things go around `/:project/annotations` and its three sibling addresses:
 * the tRPC Provider the package's own hooks run on, and the host port that
 * answers for the project, the reviewer, their grants and membership, whether
 * this is their own personal workspace, the address and the feedback. Both are
 * mounted here, once, so a screen module stays a screen module.
 *
 * The reads live here rather than in the adapter for a reason worth keeping:
 * the adapter is a value object over what has already been read, so a test
 * constructs one, while a hook cannot be constructed at all.
 *
 * `organization.getAll` is asked with the same input the application shell asks
 * with, which under tRPC's path-plus-input cache key is the same entry: the
 * graph is fetched once for the document however many halves of the product
 * want it. This family reads it for two answers — which project the address is
 * about, and whether the TEAM that project sits on is the reviewer's own
 * personal one.
 *
 * THE CONFIRMATION'S LINK IS RENDERED HERE, on the toaster's own action
 * trigger. The feedback capability carries a title and a description and no
 * action, and widening a shared port is a change a page move does not own; the
 * platform dialog put a "View queue" button inside the toast, and a toast action
 * is the same affordance without the JSX. Everything else — every failure, and
 * every success without a link — goes through the capability, so the code-keyed
 * copy still decides the words a customer reads. The datasets family's shape,
 * taken for the datasets family's reason.
 */

import {
  annotationApi,
  AnnotationHostProvider,
  type AnnotationSuccessNotice,
} from "@langwatch/annotation-web/screens/annotations";
import { toaster } from "@langwatch/design-system/toaster";
import { useMemo, type ComponentType, type ReactNode } from "react";
import { useUiCapabilities } from "../../../../behavior/ui-capabilities";
import { useUiOrganizationFacts } from "../../../../behavior/ui-organization-facts";
import { UiAnnotationHost } from "../../behavior/annotation-host.adapter";

function AnnotationHost({ children }: { children: ReactNode }) {
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
  const host = useMemo(
    () =>
      UiAnnotationHost.create(
        {
          ...(placement ? { project: placement.project } : { project: void 0 }),
          organizationId: scope.organizationId ?? void 0,
          currentUser: actor ? { id: actor.id, name: actor.name, image: actor.image } : void 0,
          hasPermission: (permission: string) => session.hasPermission(permission),
          isLiteMember,
          isOwnPersonalWorkspace,
          route: reading,
        },
        {
          setQuery: (next, options) => route.setQuery(next, options),
          navigate: (to) => navigation.navigate(to),
          succeeded: (notice: AnnotationSuccessNotice) => {
            if (!notice.action) {
              feedback.succeeded(notice);
              return;
            }
            toaster.create({
              ...(notice.id ? { id: notice.id } : {}),
              title: notice.title,
              ...(notice.description ? { description: notice.description } : {}),
              type: "success",
              action: { label: notice.action.label, onClick: notice.action.perform },
            });
          },
          failed: (failure) => feedback.failed(failure),
        },
      ),
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

/** Wraps an annotations screen in the host its package asks for. */
export function withAnnotationHost<P extends object>(Screen: ComponentType<P>): ComponentType<P> {
  const Mounted = (props: P) => (
    <AnnotationHost>
      <Screen {...props} />
    </AnnotationHost>
  );
  Mounted.displayName = `withAnnotationHost(${Screen.displayName ?? Screen.name ?? "Screen"})`;
  return Mounted;
}
