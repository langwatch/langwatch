/**
 * The project switcher's pure readings, ported from main's `ProjectSelector`
 * and `buildProjectSwitchHref`. The graph arrives already narrowed to the teams
 * the caller can open (ARCHITECTURE §10), so nothing here filters it.
 */

type Named = { readonly name: string };

export type ProjectSwitchProject = Named & {
  readonly id: string;
  readonly slug: string;
  readonly kind?: string;
};

export type ProjectSwitchTeam = Named & {
  readonly id: string;
  readonly isPersonal?: boolean;
  readonly ownerUserId?: string | null;
  readonly projects: readonly ProjectSwitchProject[];
};

export type ProjectSwitchOrganization = Named & {
  readonly id: string;
  readonly teams: readonly ProjectSwitchTeam[];
};

export type ProjectSwitchGroup = {
  readonly key: string;
  readonly organizationId: string;
  readonly title: string;
  readonly projects: readonly ProjectSwitchProject[];
};

function byName(first: Named, second: Named): number {
  const a = first.name.toLowerCase();
  const b = second.name.toLowerCase();
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

/** An admin may open a colleague's personal workspace by link, but ADR-038 keeps it unlisted. */
function isListed(team: ProjectSwitchTeam, userId: string | undefined): boolean {
  return !team.isPersonal || (!!userId && team.ownerUserId === userId);
}

/**
 * One group per team, the active organization first, then by name. Within one organization
 * a group is titled by its team, as the top bar does; across several, by organization and
 * team (dropping a team named as its organization). Empty and colleagues' personal teams stay out.
 */
export function projectSwitchGroups(
  organizations: readonly ProjectSwitchOrganization[],
  {
    userId,
    organizationId,
  }: { userId?: string | undefined; organizationId?: string | null | undefined } = {},
): ProjectSwitchGroup[] {
  const listed = organizations
    .map((organization) => ({
      organization,
      teams: organization.teams.filter(
        (team) => team.projects.length > 0 && isListed(team, userId),
      ),
    }))
    .filter(({ teams }) => teams.length > 0);
  const acrossOrganizations = listed.length > 1;
  return listed
    .toSorted(
      (first, second) =>
        Number(second.organization.id === organizationId) -
          Number(first.organization.id === organizationId) ||
        byName(first.organization, second.organization),
    )
    .flatMap(({ organization, teams }) =>
      teams.map((team) => ({
        key: team.id,
        organizationId: organization.id,
        title: groupTitle({ organization, team, acrossOrganizations }),
        projects: team.projects.toSorted(byName),
      })),
    );
}

function groupTitle({
  organization,
  team,
  acrossOrganizations,
}: {
  organization: Named;
  team: Named;
  acrossOrganizations: boolean;
}): string {
  if (!acrossOrganizations) return team.name;
  return team.name === organization.name
    ? organization.name
    : `${organization.name} - ${team.name}`;
}

/**
 * Where picking a project leads: the same page under the new project when the
 * address names the current one, else the new project's home, told to return here
 * with the query intact (the MCP consent page carries its whole OAuth request there).
 */
export function projectSwitchHref({
  pathname,
  query = {},
  currentProjectSlug,
  targetSlug,
}: {
  pathname: string;
  query?: Readonly<Record<string, string | undefined>>;
  currentProjectSlug: string | undefined;
  targetSlug: string;
}): string {
  const [, first, ...rest] = pathname.split("/");
  if (currentProjectSlug && first === currentProjectSlug) {
    return ["", targetSlug, ...rest].join("/");
  }
  if (pathname && pathname !== "/") {
    const search = new URLSearchParams(
      Object.entries(query).filter((entry): entry is [string, string] => entry[1] !== void 0),
    ).toString();
    const here = search ? `${pathname}?${search}` : pathname;
    return `/${targetSlug}?return_to=${encodeURIComponent(here)}`;
  }
  return `/${targetSlug}`;
}

const SAFE_RETURN_TO = /^\/(?!\/)[^\r\n]*$/;

/** A `return_to` that stays on this site: a rooted path, never `//host` or a scheme. */
export function safeReturnToPath(returnTo: string | undefined): string | undefined {
  return returnTo && SAFE_RETURN_TO.test(returnTo) ? returnTo : void 0;
}
