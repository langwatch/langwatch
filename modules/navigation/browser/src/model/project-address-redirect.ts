/**
 * Where an address naming the wrong project goes: main's `useOrganizationTeamProject`
 * redirect, moved into the navigation shell. specs/navigation/project-address-redirect.feature
 */

import type { NavigationOrganization, NavigationProject } from "./navigation-host.ts";

export interface ProjectAddressInput {
  /** The raw `:project` segment, reserved words included. */
  projectParam: string | undefined;
  /** The same segment when it names a project; undefined for a reserved word. */
  projectSlugFromAddress: string | undefined;
  /** The project the workspace resolved the address to. */
  project: Pick<NavigationProject, "slug"> | undefined;
  organization: Pick<NavigationOrganization, "primaryIntent"> | undefined;
  organizations: readonly Pick<NavigationOrganization, "teams">[];
  isLoading: boolean;
  demoProjectSlug: string | undefined;
  pathname: string;
  search: string;
}

/** The address to replace this one with, or null to stay. */
export function projectAddressRedirect({
  projectParam,
  projectSlugFromAddress,
  project,
  organization,
  organizations,
  isLoading,
  demoProjectSlug,
  pathname,
  search,
}: ProjectAddressInput): string | null {
  if (isLoading || projectParam === void 0 || !project) return null;
  // `/analytics` names a page, not a project: it opens that page in the current project.
  if (projectSlugFromAddress === void 0) return `/${project.slug}/${projectParam}`;
  if (demoProjectSlug && projectParam === demoProjectSlug) return null;
  // ADR-038 v6: an organization that declared its intent is never sent to a project.
  if (!organization || organization.primaryIntent) return null;
  if (!organizations.some(({ teams }) => teams.some((team) => team.projects.length > 0))) {
    return null;
  }
  if (project.slug === projectParam) return null;
  return `/${project.slug}${projectRedirectSubPath({ pathname, oldProject: projectParam })}${search}`;
}

/**
 * What follows the old project segment, so `/bad-slug/traces` keeps `/traces`.
 * The router decodes the segment and the address keeps it encoded, so both match.
 */
export function projectRedirectSubPath({
  pathname,
  oldProject,
}: {
  pathname: string;
  oldProject: string;
}): string {
  const rest = (prefix: string): string | null => {
    if (!pathname.startsWith(prefix)) return null;
    const after = pathname.slice(prefix.length);
    return after === "" || after.startsWith("/") ? after : null;
  };
  return rest(`/${oldProject}`) ?? rest(`/${encodeURIComponent(oldProject)}`) ?? "";
}
