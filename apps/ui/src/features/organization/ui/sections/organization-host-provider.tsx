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
import { useUiCapabilities } from "../../../../behavior/ui-capabilities";
import { downloadUiFile } from "../../../../behavior/ui-file-download";
import { UiProjectSwitcher } from "../../../chrome";
import { UiOrganizationHost } from "../../behavior/organization-host.adapter";

function OrganizationHost({ children }: { children: ReactNode }) {
  const { session, route, feedback, navigation } = useUiCapabilities();
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
        projects: team.projects.map((project) => ({ id: project.id, name: project.name })),
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
  const projectSlug = useMemo(() => {
    if (!activeScope.projectId) return void 0;
    for (const candidate of organizations.data ?? []) {
      for (const team of candidate.teams) {
        const project = team.projects.find((entry) => entry.id === activeScope.projectId);
        if (project) return project.slug;
      }
    }
    return void 0;
  }, [organizations.data, activeScope.projectId]);

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
          route: reading,
          // The recorded gap, closed: the chrome layout route mounts the
          // navigation host above every settings address, so the switcher the
          // header draws is the one this screen is handed.
          projectSwitcher: <UiProjectSwitcher />,
        },
        {
          hasPermission: (permission) => session.hasPermission(permission),
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
      organization,
      reading,
      session,
      route,
      navigation,
      feedback,
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
