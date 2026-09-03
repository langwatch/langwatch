/**
 * What the organization settings screens are mounted inside.
 *
 * Two things go around every `/settings/*` address this family answers: the
 * tRPC Provider the package's own hooks run on, and the host port that answers
 * for the organization graph, one grant, the address, the project switcher, the
 * file to hand over and one notice.
 *
 * The reads live here rather than in a separate adapter: the port is satisfied
 * by a structural object literal, so there is no class left to test in
 * isolation — the reads that produce its answers are the thing worth reading.
 *
 * `organization.getAll` is asked with the same input the application shell asks
 * with, which under tRPC's path-plus-input cache key is the same entry: the
 * graph is fetched once for the document however many halves of the product
 * want it. This family reads two things off it — the teams and projects the
 * Project filter offers, and the ACTIVE PROJECT'S SLUG, which is what the back
 * link out of a gateway deep-link is addressed with.
 */

import {
  organizationApi,
  OrganizationHostProvider,
  type OrganizationHostPort,
  type OrganizationReading,
} from "@langwatch/organization-web/screens/organization";
import { useDrawer } from "@langwatch/ui-drawer";
import { useMemo, type ReactNode } from "react";
import { readPublicAppConfig } from "../../../../behavior/public-config";
import { useUiCapabilities } from "../../../../behavior/ui-capabilities";
import { downloadUiFile } from "../../../../behavior/ui-file-download";
import { useUiOrganizationFacts } from "../../../../behavior/ui-organization-facts";
import { UiProjectSwitcher } from "../../../chrome";

/**
 * Whether this deployment can send email.
 *
 * `platform/app` asked `usePublicEnv`, a round trip; this application declares
 * its whole public configuration in a meta tag at boot. A document with no tag
 * reads as CANNOT SEND, which is the fail-safe direction: the members page then
 * offers the invitation link, which works either way, rather than claiming a
 * message went out that never did.
 */
function readHasEmailProvider(): boolean {
  try {
    return readPublicAppConfig().capabilities.email;
  } catch {
    return false;
  }
}

export function OrganizationHost({ children }: { children: ReactNode }) {
  const { session, route, feedback, navigation } = useUiCapabilities();
  const { isEnterprise, isPlanLoading } = useUiOrganizationFacts();
  const { openDrawer, closeDrawer } = useDrawer();
  const activeScope = session.activeScope();

  const organizations = organizationApi.organization.getAll.useQuery({ isDemo: false });

  const organization: OrganizationReading | undefined = useMemo(() => {
    const found = (organizations.data ?? []).find(
      (candidate) => candidate.id === activeScope.organizationId,
    );
    if (!found) return void 0;
    return {
      id: found.id,
      name: found.name,
      teams: found.teams.map((team) => ({
        id: team.id,
        name: team.name,
        slug: team.slug,
        projects: team.projects.map((project) => ({
          id: project.id,
          name: project.name,
          slug: project.slug,
        })),
      })),
    };
  }, [organizations.data, activeScope.organizationId]);

  /**
   * The active project's slug, looked up in the graph already read.
   *
   * `UiActiveScope` carries ids and no slugs, and the back link out of a
   * gateway deep-link is a `/:project/...` address. Absent means the back link
   * is not offered, which is the honest answer rather than a link built from an
   * id the router would not match.
   */
  const activeProject = useMemo(() => {
    if (!activeScope.projectId) return void 0;
    for (const candidate of organizations.data ?? []) {
      for (const team of candidate.teams) {
        const project = team.projects.find((entry) => entry.id === activeScope.projectId);
        if (project) return project;
      }
    }
    return void 0;
  }, [organizations.data, activeScope.projectId]);
  const projectSlug = activeProject?.slug;

  const reading = route.reading();
  const host = useMemo<OrganizationHostPort>(
    () => ({
      scope: () => ({
        organizationId: activeScope.organizationId ?? void 0,
        projectId: activeScope.projectId ?? void 0,
        projectSlug,
      }),
      organization: () => organization,
      hasPermission: (permission) => session.hasPermission(permission),
      // The application's session resolves permissions for whatever scope the
      // address names, and every settings address here is the organization's
      // own — so the two questions have the same answer on these pages, and
      // the port keeps them apart for the ones where they will not.
      hasOrganizationPermission: (permission) => session.hasPermission(permission),
      currentUser: () => session.currentUser() ?? void 0,
      activeProject: () => activeProject,
      isEnterprise: () => isEnterprise,
      isPlanLoading: () => isPlanLoading,
      hasEmailProvider: () => readHasEmailProvider(),
      isFeatureEnabled: (flag) => session.isFeatureEnabled(flag),
      openOverlay: (name, props) => openDrawer(name, props),
      closeOverlay: () => closeDrawer(),
      succeeded: (notice) => feedback.succeeded(notice),
      route: () => reading,
      setQuery: (next, options) => route.setQuery(next, options),
      // The recorded gap, closed: the chrome layout route mounts the
      // navigation host above every settings address, so the switcher the
      // header draws is the one this screen is handed.
      projectSwitcher: () => <UiProjectSwitcher />,
      navigate: (to) => navigation.navigate(to),
      download: (file) => downloadUiFile(file),
      failed: (failure) => feedback.failed(failure),
    }),
    [
      activeScope.organizationId,
      activeScope.projectId,
      projectSlug,
      activeProject,
      organization,
      isEnterprise,
      isPlanLoading,
      reading,
      session,
      route,
      navigation,
      feedback,
      openDrawer,
      closeDrawer,
    ],
  );

  return <OrganizationHostProvider value={host}>{children}</OrganizationHostProvider>;
}

export { organizationApi };
