/**
 * What the Audit Log screen is mounted inside.
 *
 * Two things go around `/settings/audit-log`: the tRPC Provider the package's
 * own hooks run on, and the host port that answers for the organization graph,
 * the one grant, the address, the project switcher this application does not
 * yet have to offer, the file the export hands over and the one notice.
 *
 * The reads live here rather than in the adapter for a reason worth keeping:
 * the adapter is a value object over what has already been read, so a test
 * constructs one, while a hook cannot be constructed at all.
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
  type OrganizationReading,
} from "@langwatch/organization-web/screens/organization";
import { useMemo, type ComponentType, type ReactNode } from "react";
import { useDrawer } from "@langwatch/ui-drawer";
import { readPublicAppConfig } from "../../../../behavior/public-config";
import { useUiCapabilities } from "../../../../behavior/ui-capabilities";
import { downloadUiFile } from "../../../../behavior/ui-file-download";
import { useUiOrganizationFacts } from "../../../../behavior/ui-organization-facts";
import { UiProjectSwitcher } from "../../../chrome";
import { UiOrganizationHost } from "../../behavior/organization-host.adapter";

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

function OrganizationHost({ children }: { children: ReactNode }) {
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
  const host = useMemo(
    () =>
      UiOrganizationHost.create(
        {
          scope: {
            organizationId: activeScope.organizationId ?? void 0,
            projectId: activeScope.projectId ?? void 0,
            projectSlug,
          },
          organization,
          activeProject,
          currentUser: session.currentUser() ?? void 0,
          isEnterprise,
          isPlanLoading,
          hasEmailProvider: readHasEmailProvider(),
          route: reading,
          // The recorded gap, closed: the chrome layout route mounts the
          // navigation host above every settings address, so the switcher the
          // header draws is the one this screen is handed.
          projectSwitcher: <UiProjectSwitcher />,
        },
        {
          hasPermission: (permission) => session.hasPermission(permission),
          // The application's session resolves permissions for whatever scope
          // the address names, and every settings address here is the
          // organization's own — so the two questions have the same answer on
          // these pages, and the port keeps them apart for the ones where they
          // will not.
          hasOrganizationPermission: (permission) => session.hasPermission(permission),
          isFeatureEnabled: (flag) => session.isFeatureEnabled(flag),
          openOverlay: (name, props) => openDrawer(name, props),
          closeOverlay: () => closeDrawer(),
          succeeded: (notice) => feedback.succeeded(notice),
          setQuery: (next, options) => route.setQuery(next, options),
          navigate: (to) => navigation.navigate(to),
          download: (file) => downloadUiFile(file),
          failed: (failure) => feedback.failed(failure),
        },
      ),
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

/** Wraps the Audit Log screen in the host its package asks for. */
export function withOrganizationHost<P extends object>(Screen: ComponentType<P>): ComponentType<P> {
  const Mounted = (props: P) => (
    <OrganizationHost>
      <Screen {...props} />
    </OrganizationHost>
  );
  Mounted.displayName = `withOrganizationHost(${Screen.displayName ?? Screen.name ?? "Screen"})`;
  return Mounted;
}

export { organizationApi };
