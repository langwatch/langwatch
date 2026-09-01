/**
 * Which organization, team and project a page is about.
 *
 * Harvested from the application's `useOrganizationTeamProject`, whose 770
 * lines are the only statement of these rules that exists. A second, slightly
 * different answer to "what project is this page about" is a tenancy bug, so
 * this is a move rather than a rewrite: same precedence, same reserved slugs,
 * same stickiness rules, same demo handling. What changed is the shape — the
 * decisions are pure functions over route, storage and data, and the hook that
 * feeds them lives at the edge in `ui-session`.
 *
 * The order of preference, top to bottom:
 *
 *   1. the demo project, when the address names the deployment's demo slug
 *   2. a `?team=` slug that matches a team the caller can see
 *   3. a `:project` slug in the address bar, reserved slugs excluded
 *   4. the same slug carried over from storage, unless it is stale (below)
 *   5. the caller's own personal workspace, on the personal-workspace pages
 *   6. the remembered team, when the caller can still be shown it
 *   7. the ambient team — a shared team the caller is on, project first
 */

import {
  UI_ORGANIZATION_ADMIN_ROLE,
  UI_RESERVED_PROJECT_SLUGS,
  type UiResolvedScope,
  type UiScopeOrganization,
  type UiScopeProject,
  type UiScopeRoute,
  type UiScopeSelection,
  type UiScopeTeam,
} from "../model/ui-scope";

/**
 * Whether the caller holds a membership on this team.
 *
 * `organization.getAll` returns every team in the organization but narrows
 * `team.members` to the caller's own row, synthesizing one from a RoleBinding
 * when the legacy membership row is absent.
 */
export function userBelongsToTeam(team: Pick<UiScopeTeam, "members">, userId: string): boolean {
  return team.members?.some((member) => member.userId === userId) ?? false;
}

/** The caller's own role in an organization, or undefined outside one. */
export function organizationRoleOf(
  organization: Pick<UiScopeOrganization, "members"> | undefined,
): string | undefined {
  // `organization.getAll` narrows `members` to the caller's own row.
  return organization?.members?.[0]?.role;
}

/**
 * Whether the caller can be shown a team's context.
 *
 * A membership row answers it, and so does the organization ADMIN role on its
 * own: `organization.getAll` hands an admin every team of the organization
 * with no membership row in most of them, and the server grants team
 * permissions on the admin role alone. The chrome applies the same two-part
 * test, so a context this accepts is one a page renders rather than refuses.
 *
 * A caller with no user id yet is not held to the test: the session is still
 * resolving, and refusing there would drop a selection that is about to be
 * valid.
 */
export function userCanOpenTeam({
  team,
  userId,
  organizationRole,
}: {
  team: Pick<UiScopeTeam, "members">;
  userId: string | undefined;
  organizationRole: string | undefined;
}): boolean {
  if (organizationRole === UI_ORGANIZATION_ADMIN_ROLE) return true;
  if (!userId) return true;
  return userBelongsToTeam(team, userId);
}

/**
 * Ambient team for organization-level work.
 *
 * Membership decides first. The teams list carries the whole organization, not
 * just the caller's corner of it, so a preference expressed purely as "the
 * first team shaped like X" hands members a team they are not on the moment an
 * organization has more than one — and everything scoped to the ambient
 * project then aims at a project in someone else's team.
 *
 * Within the teams the caller does belong to, the order is: a shared team that
 * already holds a project, then any shared team, then whatever is left.
 *
 * Personal workspaces sort last because they are a private context — one
 * project, owned by one person — while everything scoped to the ambient
 * project belongs to the organization. A personal team always holds exactly
 * one project, so a plain "first team with a project" lookup lets it win
 * whenever it sorts first. An organization whose only team is personal still
 * resolves to it, so a solo user is never left without a context.
 */
export function selectAmbientTeam<
  T extends {
    isPersonal?: boolean | null;
    projects: readonly unknown[];
    members?: readonly { userId?: string }[];
  },
>({ teams, userId }: { teams: readonly T[]; userId?: string }): T | undefined {
  const byPreference = (candidates: readonly T[]) =>
    candidates.find((team) => !team.isPersonal && team.projects.length > 0) ??
    candidates.find((team) => !team.isPersonal) ??
    candidates.find((team) => team.projects.length > 0) ??
    candidates[0];

  const own = userId ? teams.filter((team) => userBelongsToTeam(team, userId)) : teams;

  return byPreference(own) ?? byPreference(teams);
}

/** The `:project` segment, once the reserved top-level addresses are excluded. */
export function projectSlugAddressedBy(projectParam: string | undefined): string | undefined {
  return projectParam && !UI_RESERVED_PROJECT_SLUGS.includes(projectParam)
    ? projectParam
    : undefined;
}

export type UiScopeResolutionInput = {
  readonly route: UiScopeRoute;
  /** Undefined until `organization.getAll` has answered. */
  readonly organizations: readonly UiScopeOrganization[] | undefined;
  readonly userId: string | undefined;
  readonly selection: UiScopeSelection;
  /** The deployment's demo project slug, when it has one. */
  readonly demoProjectSlug?: string | undefined;
};

/**
 * One organization / team / project match for a project slug.
 *
 * A slug is unique within a team, never across the whole graph, so a match
 * carries the organization and team it was found under.
 */
type UiSlugMatch = {
  organization: UiScopeOrganization;
  team: UiScopeTeam;
  project: UiScopeProject;
};

export function resolveUiScope({
  route,
  organizations,
  userId,
  selection,
  demoProjectSlug,
}: UiScopeResolutionInput): UiResolvedScope {
  const projectParam = route.projectParam;
  const projectSlugFromUrl = projectSlugAddressedBy(projectParam);
  const projectSlug = projectSlugFromUrl ?? selection.projectSlug;
  const teamSlug = route.teamParam;

  const teamsMatchingSlug = teamSlug
    ? organizations?.flatMap((organization) =>
        organization.teams
          .filter((team) => team.slug === teamSlug)
          .map((team) => ({ organization, team })),
      )
    : void 0;

  // The address bar is what separates "the user is in their personal
  // workspace" from "the app picked it for them". A personal project or team
  // named in the URL resolves exactly like any other; the persisted selection
  // does not, because nothing on an organization-scoped page tells the user
  // which project it is about to write to. A `?team=` that resolves to no team
  // the user can see addresses nothing, so it stays out of the predicate.
  const isAddressedBySlug = !!projectSlugFromUrl || !!teamsMatchingSlug?.[0];

  const slugMatches: UiSlugMatch[] =
    organizations?.flatMap((organization) =>
      (teamsMatchingSlug?.[0]
        ? teamsMatchingSlug.map(({ team }) => team)
        : organization.teams
      ).flatMap((team) =>
        team.projects
          .filter((project) => project.slug === projectSlug)
          .map((project) => ({ organization, project, team }))
          .sort((a, b) => {
            // Slugs can repeat across teams and organizations, so several can
            // match. Prefer the ones that also match the remembered ids.
            if (a.organization.id === selection.organizationId) return -1;
            if (b.organization.id === selection.organizationId) return 1;
            if (a.team.id === selection.teamId) return -1;
            if (b.team.id === selection.teamId) return 1;
            return 0;
          }),
      ),
    ) ?? [];

  // A slug can name a project in more than one team, so prefer a match on a
  // team the caller is on before falling back to the first one.
  const slugMatch =
    (userId ? slugMatches.find((match) => userBelongsToTeam(match.team, userId)) : void 0) ??
    slugMatches[0];

  // A slug that resolved off the persisted selection rather than off the URL
  // is stickiness, not intent: it survives from the last visit to a project
  // page into every organization-scoped page that carries no project of its
  // own. Three kinds have to be dropped there — a personal workspace is a
  // private context the caller never asked to work in, a team the caller
  // cannot be shown is one the chrome refuses outright, and any project at all
  // is the wrong answer on the personal-workspace pages. All three let the
  // ambient resolution below pick again, and the pick is re-persisted, so the
  // stale selection heals itself.
  //
  // An organization admin passes the second test on their role, so the project
  // they picked in a team they hold no membership row in stays picked. A slug
  // named in the address bar keeps resolving exactly as before, including into
  // a team the caller cannot open: the refusal that follows is the plain
  // answer to typing someone else's project into the URL.
  const stickySlugIsUnusable =
    !!slugMatch &&
    !isAddressedBySlug &&
    (route.isPersonalScopeRoute ||
      !!slugMatch.team.isPersonal ||
      !userCanOpenTeam({
        team: slugMatch.team,
        userId,
        organizationRole: organizationRoleOf(slugMatch.organization),
      }));
  const resolvedSlugMatch = stickySlugIsUnusable ? void 0 : slugMatch;

  const isDemo = Boolean(demoProjectSlug && projectParam === demoProjectSlug);

  // In demo mode the reply carries the caller's own organizations AND the demo
  // one, so the demo organization is found by the project it holds.
  const organization = isDemo
    ? (organizations?.find((candidate) =>
        candidate.teams.some((team) =>
          team.projects.some((project) => project.slug === demoProjectSlug),
        ),
      ) ?? organizations?.[0])
    : teamsMatchingSlug?.[0]
      ? teamsMatchingSlug[0].organization
      : resolvedSlugMatch
        ? resolvedSlugMatch.organization
        : organizations
          ? (organizations.find((candidate) => candidate.id === selection.organizationId) ??
            organizations[0])
          : void 0;

  // The personal workspace itself, on the pages that are about it. Checked
  // BEFORE the remembered-team lookup, not merely added as a further fallback
  // after it: a caller who visited any organization-scoped page earlier in the
  // session has a shared team id persisted, that stale selection legitimately
  // wins on THOSE pages, and it must never win on the personal-workspace
  // pages, which cannot mean anything else.
  const ownPersonalTeam = route.isPersonalScopeRoute
    ? organization?.teams.find((team) => team.isPersonal && team.ownerUserId === userId)
    : void 0;

  // The remembered selection carries the same test as the ambient pick below.
  // Without it a persisted team id keeps resolving a team the caller cannot be
  // shown, long after the resolution itself stopped producing one: the
  // selection is written from whatever last resolved, so a bad pick outlives
  // the page that made it.
  const rememberedTeam = organization?.teams.find(
    (team) =>
      team.id === selection.teamId &&
      !team.isPersonal &&
      userCanOpenTeam({
        team,
        userId,
        organizationRole: organizationRoleOf(organization),
      }),
  );

  const team = isDemo
    ? (organization?.teams.find((candidate) =>
        candidate.projects.some((project) => project.slug === demoProjectSlug),
      ) ?? selectAmbientTeam({ teams: organization?.teams ?? [], userId }))
    : resolvedSlugMatch
      ? resolvedSlugMatch.team
      : ownPersonalTeam
        ? ownPersonalTeam
        : organization
          ? (rememberedTeam ?? selectAmbientTeam({ teams: organization.teams, userId }))
          : void 0;

  const project = isDemo
    ? (team?.projects.find((candidate) => candidate.slug === demoProjectSlug) ?? team?.projects[0])
    : team
      ? (resolvedSlugMatch?.project ?? team.projects[0])
      : void 0;

  // The demo project answers to the slug the address bar used, whatever the
  // record says.
  const resolvedProject =
    isDemo && project ? { ...project, slug: demoProjectSlug ?? "demo" } : project;

  const organizationRole = organizationRoleOf(organization);

  return {
    ...(organization ? { organization } : {}),
    ...(team ? { team } : {}),
    ...(resolvedProject ? { project: resolvedProject } : {}),
    ...(organizationRole !== void 0 ? { organizationRole } : {}),
    isDemo,
  };
}

/** One remembered value, and what it should become. */
export type UiScopeSelectionWrite =
  | { readonly key: "organizationId"; readonly value: string }
  | { readonly key: "teamId"; readonly value: string }
  | { readonly key: "projectSlug"; readonly value: string }
  | { readonly key: "lastVisitedHomeKind"; readonly value: "project" };

/**
 * What the resolution should leave behind for the next page.
 *
 * Pure, and every write is guarded by "it differs from what is already
 * stored". That guard is not an optimisation: each write broadcasts a storage
 * event that re-renders every mounted reader, and an unguarded write re-fires
 * on every pass — inside a route transition's effect cascade that trips
 * React's nested-update limit and wedges navigation.
 */
export function uiScopeSelectionWrites({
  resolved,
  selection,
  projectParam,
  lastVisitedHomeKind,
}: {
  resolved: UiResolvedScope;
  selection: UiScopeSelection;
  projectParam: string | undefined;
  lastVisitedHomeKind: string;
}): UiScopeSelectionWrite[] {
  // The demo project is a visitor's context, not the caller's own work.
  if (resolved.isDemo) return [];

  const writes: UiScopeSelectionWrite[] = [];
  const { organization, team, project } = resolved;

  if (organization && organization.id !== selection.organizationId) {
    writes.push({ key: "organizationId", value: organization.id });
  }

  // The remembered selection answers "where was I working", which is a
  // question about the organization's teams and projects. A personal workspace
  // is not one of them: written here it replaces the project the reader had
  // open. The private context resolves from its own address every time, so it
  // needs nothing remembered.
  if (!team?.isPersonal) {
    if (team && team.id !== selection.teamId) {
      writes.push({ key: "teamId", value: team.id });
    }
    if (project && project.slug !== selection.projectSlug) {
      writes.push({ key: "projectSlug", value: project.slug });
    }
  }

  // Visiting an actual project page marks the implicit home preference as
  // "project". Gated on the URL actually carrying a project slug: a project
  // also resolves from the persisted selection on pages that name none, and
  // marking "project" there would clobber the personal-home marker. The
  // VALIDATED slug, so reserved addresses like /messages do not count as
  // project visits either.
  if (project && !!projectSlugAddressedBy(projectParam) && lastVisitedHomeKind !== "project") {
    writes.push({ key: "lastVisitedHomeKind", value: "project" });
  }

  return writes;
}
