/** Projects switcher offers; one answer for both; "New Project" for project:create access */

import type { ProjectPickerGroup } from "@langwatch/design-system/project-picker";
import { isAggregateProjectKind } from "@langwatch/project-contract";

import { useNavigationHost, useOptionalNavigationHost } from "../model/navigation-host.ts";
import type { OpenBoard } from "../model/open-board.ts";
import { isListedInSwitcher } from "../model/personal-team.ts";
import { isOrganizationDashboardsPath } from "../model/products.ts";

/** Project pick destination: swap project segment, drop trailing dynamic segments */
export function projectSwitchHref({
  pathname,
  routePattern,
  currentSlug,
  nextSlug,
}: {
  pathname: string;
  routePattern?: string | undefined;
  currentSlug: string | undefined;
  nextSlug: string;
}): string {
  if (!currentSlug) return `/${nextSlug}`;
  const prefix = `/${currentSlug}`;
  if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) return `/${nextSlug}`;
  const kept = dropExtraDynamicSegment({ pathname, routePattern });
  return `/${nextSlug}${kept.slice(prefix.length)}`;
}

/** Drops first dynamic segment past :project per routePattern */
function dropExtraDynamicSegment({
  pathname,
  routePattern,
}: {
  pathname: string;
  routePattern: string | undefined;
}): string {
  if (!routePattern) return pathname;
  const patternSegments = routePattern.split("/");
  const pathSegments = pathname.split("/");
  if (patternSegments.length !== pathSegments.length) return pathname;

  const extraDynamicIndex = patternSegments.findIndex(
    (segment, index) => index > 1 && segment.startsWith(":"),
  );
  if (extraDynamicIndex === -1) return pathname;

  return pathSegments.slice(0, extraDynamicIndex).join("/") || "/";
}

/**
 * A pick's destination with a board open (ADR-002, D2): a Project-shared board reads its own
 * project, so the pick opens the next project's LLM Ops home; any other board stays open, at a
 * project's address in the next project, at the organization's with the next project in view.
 */
export function projectPickHref({
  pathname,
  routePattern,
  currentSlug,
  nextSlug,
  openBoard,
}: {
  pathname: string;
  routePattern?: string | undefined;
  currentSlug: string | undefined;
  nextSlug: string;
  openBoard: OpenBoard | null;
}): string {
  if (!openBoard) return projectSwitchHref({ pathname, routePattern, currentSlug, nextSlug });
  if (openBoard.isProjectShared || isOrganizationDashboardsPath(pathname)) return `/${nextSlug}`;
  return projectSwitchHref({ pathname, currentSlug, nextSlug });
}

/**
 * At an organization-level board that reads the project in view, a pick changes that project and
 * keeps the board open; undefined everywhere else, where a pick navigates to its address.
 */
export function useProjectInViewPick({
  openBoard,
}: {
  openBoard: OpenBoard | null;
}): ((href: string) => void) | undefined {
  const host = useNavigationHost();
  const keepsBoard =
    openBoard !== null &&
    !openBoard.isProjectShared &&
    isOrganizationDashboardsPath(host.pathname());
  if (!keepsBoard) return void 0;
  return (href) => {
    const team = host
      .openableTeams()
      .find((candidate) => candidate.projects.some(({ slug }) => `/${slug}` === href));
    const project = team?.projects.find(({ slug }) => `/${slug}` === href);
    if (!team || !project) return;
    host.rememberScope({ teamId: team.id, projectSlug: project.slug });
  };
}

/** Teams reader may open with projects; host is optional since switcher handed across seam */
export function useProjectPickGroups({
  openBoard = null,
}: { openBoard?: OpenBoard | null } = {}): ProjectPickerGroup[] {
  const host = useOptionalNavigationHost();
  const organization = host?.organization();
  const project = host?.project();
  const pathname = host?.pathname() ?? "/";
  const routePattern = host?.routePattern();
  const userId = host?.currentUser()?.id;

  const canCreateProject = host?.hasPermission("project:create") ?? false;

  if (!host || !organization) return [];
  return host
    .openableTeams()
    .filter((team) => isListedInSwitcher(team, userId))
    .filter((team) => team.projects.length > 0 || canCreateProject)
    .map((team) => ({
      team: {
        teamId: team.id,
        orgId: organization.id,
        label: team.name,
        // A personal workspace holds its owner's one project; main offered no create there.
        canCreateProject: canCreateProject && !team.isPersonal,
      },
      projects: team.projects.map((candidate) => ({
        projectId: candidate.id,
        label: candidate.name,
        isAggregate: isAggregateProjectKind(candidate.kind),
        href: projectPickHref({
          pathname,
          routePattern,
          currentSlug: project?.slug,
          nextSlug: candidate.slug,
          openBoard,
        }),
      })),
    }));
}
