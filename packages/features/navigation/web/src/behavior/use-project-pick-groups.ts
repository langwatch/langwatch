/**
 * Which projects the switcher offers, and where each one goes.
 *
 * ONE ANSWER FOR THE TWO SWITCHERS. The application chrome renders the
 * combobox in its header, and the shell's top bar renders the same control as
 * the LLM Ops scope; both used to build these groups for themselves — the
 * application from the navigation host, the shell from `platform/app`'s
 * `useWorkspaceData` — and a switcher that offers a different list depending on
 * which header drew it is the "two co-existing workspace switchers" bug in a
 * new shape.
 *
 * WHERE A PICK GOES is the rule that needs no route table: swap the `:project`
 * segment of the address the reader is on, and fall back to the project home
 * for an address that carries none. `platform/app`'s `projectRoutes` lookup did
 * not travel and no longer exists; this gives the same answer for every
 * `/:project/...` page, which is every page a switcher is rendered above.
 *
 * WHAT IT DOES NOT OFFER is the per-team "New Project" entry. That opened
 * `platform/app`'s create-project drawer, which is a component of the
 * application being deleted. An entry that cannot do what it says is worse
 * than no entry, so `canCreateProject` stays false and the row is not built.
 */

import { useMemo } from "react";
import { useOptionalNavigationHost } from "../model/navigation-host";
import type { ProjectPickGroup } from "../model/project-pick-items";

/**
 * The address a project pick lands on: the reader's own, with the project
 * segment swapped.
 *
 * The segment boundary is load-bearing. `/acme-app-staging/traces` is not a
 * sub-path of `/acme-app`, and a plain `startsWith` would rewrite it into an
 * address that belongs to neither project.
 */
export function projectSwitchHref({
  pathname,
  currentSlug,
  nextSlug,
}: {
  pathname: string;
  currentSlug: string | undefined;
  nextSlug: string;
}): string {
  if (!currentSlug) return `/${nextSlug}`;
  const prefix = `/${currentSlug}`;
  if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) return `/${nextSlug}`;
  return `/${nextSlug}${pathname.slice(prefix.length)}`;
}

/**
 * The teams the reader may open, with the projects under each and the address
 * a pick lands on.
 *
 * The host is read as OPTIONAL because the switcher is handed ACROSS a seam: a
 * screen's own host port carries it as a `ReactNode` and the screen decides
 * where in its header to put it, so it can be rendered somewhere the chrome
 * layout route does not reach. No host is no groups, which renders no switcher
 * — the answer those ports gave before there was one.
 */
export function useProjectPickGroups(): ProjectPickGroup[] {
  const host = useOptionalNavigationHost();
  const organization = host?.organization();
  const project = host?.project();
  const pathname = host?.pathname() ?? "/";

  return useMemo(() => {
    if (!host || !organization) return [];
    return host
      .openableTeams()
      .filter((team) => team.projects.length > 0)
      .map((team) => ({
        team: {
          teamId: team.id,
          orgId: organization.id,
          label: team.name,
          canCreateProject: false,
        },
        projects: team.projects.map((candidate) => ({
          projectId: candidate.id,
          label: candidate.name,
          href: projectSwitchHref({
            pathname,
            currentSlug: project?.slug,
            nextSlug: candidate.slug,
          }),
        })),
      }));
  }, [host, organization, pathname, project?.slug]);
}
