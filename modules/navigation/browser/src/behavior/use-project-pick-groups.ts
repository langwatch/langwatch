/** Projects switcher offers; one answer for both; "New Project" for project:create access */

import { useMemo } from "react";

import { useOptionalNavigationHost } from "../model/navigation-host.ts";
import type { ProjectPickGroup } from "../model/project-pick-items.ts";

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

/** Teams reader may open with projects; host is optional since switcher handed across seam */
export function useProjectPickGroups(): ProjectPickGroup[] {
  const host = useOptionalNavigationHost();
  const organization = host?.organization();
  const project = host?.project();
  const pathname = host?.pathname() ?? "/";
  const routePattern = host?.routePattern();

  const canCreateProject = host?.hasPermission("project:create") ?? false;

  return useMemo(() => {
    if (!host || !organization) return [];
    return host
      .openableTeams()
      .filter((team) => team.projects.length > 0 || canCreateProject)
      .map((team) => ({
        team: {
          teamId: team.id,
          orgId: organization.id,
          label: team.name,
          canCreateProject,
        },
        projects: team.projects.map((candidate) => ({
          projectId: candidate.id,
          label: candidate.name,
          href: projectSwitchHref({
            pathname,
            routePattern,
            currentSlug: project?.slug,
            nextSlug: candidate.slug,
          }),
        })),
      }));
  }, [host, organization, pathname, routePattern, project?.slug, canCreateProject]);
}
