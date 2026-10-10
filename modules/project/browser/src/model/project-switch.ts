/**
 * The project switcher's pure readings, ported from main's `ProjectSelector`
 * and `buildProjectSwitchHref`. The graph arrives already narrowed to the teams
 * the caller can open (ARCHITECTURE §10), so nothing here filters it.
 */

type Named = { readonly name: string };

export type ProjectSwitchProject = Named & { readonly id: string; readonly slug: string };

export type ProjectSwitchOrganization = Named & {
  readonly id: string;
  readonly teams: readonly (Named & {
    readonly id: string;
    readonly projects: readonly ProjectSwitchProject[];
  })[];
};

export type ProjectSwitchGroup = {
  readonly key: string;
  readonly title: string;
  readonly projects: readonly ProjectSwitchProject[];
};

function byName(first: Named, second: Named): number {
  const a = first.name.toLowerCase();
  const b = second.name.toLowerCase();
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

/**
 * One group per team, organizations and projects by name; the title drops a team
 * named as its organization.
 */
export function projectSwitchGroups(
  organizations: readonly ProjectSwitchOrganization[],
): ProjectSwitchGroup[] {
  return organizations.toSorted(byName).flatMap((organization) =>
    organization.teams.map((team) => ({
      key: team.id,
      title:
        team.name === organization.name ? organization.name : `${organization.name} - ${team.name}`,
      projects: team.projects.toSorted(byName),
    })),
  );
}

/**
 * Where picking a project leads: the same page under the new project when the
 * address names the current one, else the new project's home, told to return here.
 */
export function projectSwitchHref({
  pathname,
  currentProjectSlug,
  targetSlug,
}: {
  pathname: string;
  currentProjectSlug: string | undefined;
  targetSlug: string;
}): string {
  const [, first, ...rest] = pathname.split("/");
  if (currentProjectSlug && first === currentProjectSlug) {
    return ["", targetSlug, ...rest].join("/");
  }
  if (pathname && pathname !== "/") {
    return `/${targetSlug}?return_to=${encodeURIComponent(pathname)}`;
  }
  return `/${targetSlug}`;
}

const SAFE_RETURN_TO = /^\/(?!\/)[^\r\n]*$/;

/** A `return_to` that stays on this site: a rooted path, never `//host` or a scheme. */
export function safeReturnToPath(returnTo: string | undefined): string | undefined {
  return returnTo && SAFE_RETURN_TO.test(returnTo) ? returnTo : void 0;
}
