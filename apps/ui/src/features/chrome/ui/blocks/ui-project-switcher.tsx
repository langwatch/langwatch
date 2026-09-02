/**
 * The project switcher, as this application answers it.
 *
 * `@langwatch/navigation-web` owns the control — the combobox, its search, its
 * keyboard and its rows. What belongs here is the only thing the control does
 * not carry: WHICH projects to offer and WHERE each one goes. Both come off the
 * navigation host, so this block fetches nothing.
 *
 * WHERE A PICK GOES. The platform chrome ran the current address through its
 * `projectRoutes` table to keep the reader on the same page in the new project.
 * That table is `platform/app`'s and did not travel, so the rule here is the one
 * that needs no table: swap the `:project` segment of the address the reader is
 * on, and fall back to the project home for an address that carries none. Same
 * outcome for every `/:project/...` page, which is every page the switcher is
 * rendered above.
 *
 * WHAT IT DOES NOT OFFER is the per-team "New Project" entry. That opens
 * `platform/app`'s `createProject` drawer, and nothing mounts that registry
 * above a screen served from here — see `features/chrome/index.ts`. An entry
 * that cannot do what it says is worse than no entry, so `canCreateProject` is
 * left false and the row is not built.
 */

import {
  ProjectSwitcherCombobox,
  useOptionalNavigationHost,
  type ProjectPickGroup,
} from "@langwatch/navigation-web/chrome";
import { useLocation } from "react-router";
import { useMemo } from "react";

/**
 * The address a project pick lands on: the reader's own, with the project
 * segment swapped.
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

export function UiProjectSwitcher() {
  // Read as OPTIONAL: this control is handed across a seam — a screen's host
  // port carries it as a `ReactNode` and the screen decides where in its header
  // to put it — so it can be rendered somewhere the chrome layout route does not
  // reach. No host is no switcher, which is the answer those ports gave before
  // this one existed.
  const host = useOptionalNavigationHost();
  const { pathname } = useLocation();
  const project = host?.project();
  const organization = host?.organization();

  const groups: ProjectPickGroup[] = useMemo(() => {
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

  // Nothing to switch between is nothing to render: a single-project reader
  // gets the page's own title rather than a control that only ever answers
  // with where they already are.
  const projectCount = groups.reduce((total, group) => total + group.projects.length, 0);
  if (!project || projectCount < 2) return null;

  return (
    <ProjectSwitcherCombobox
      groups={groups}
      currentProjectId={project.id}
      currentProjectName={project.name}
      showTeamHeaders={groups.length > 1}
      onCreateProjectForTeam={void 0}
    />
  );
}
