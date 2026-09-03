/**
 * Which organization, team and project a page is about — a pure-function
 * harvest of the 770-line `useOrganizationTeamProject` (same rules,
 * moved not rewritten). Precedence order: `ui-family-move-manifests.md`.
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
 * Whether the caller holds a membership on this team — `organization.getAll`
 * narrows `team.members` to the caller's own row, synthesizing one from
 * a RoleBinding when the legacy membership row is absent.
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
 * Whether the caller can be shown a team's context — a membership row,
 * or the organization ADMIN role alone. No user id yet: not held to
 * the test, since the session is still resolving.
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
 * Ambient team for organization-level work. Membership decides first —
 * the teams list carries the whole organization, not just the caller's
 * corner. Ordering and the personal-sorts-last rule: `ui-family-move-manifests.md`.
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
 * One match for a project slug — unique within a team, never across the
 * whole graph, so a match carries the organization and team it was found under.
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

  // The address bar separates "the user is in their personal workspace"
  // from "the app picked it for them": a URL slug resolves like any
  // other, but the persisted selection does not (see the stickiness rule
  // in `ui-family-move-manifests.md`).
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

  // Stale stickiness, not intent — dropped for a personal workspace, a
  // team the chrome refuses, or any project on personal-workspace pages;
  // the ambient pick below re-resolves and re-persists, healing itself.
  // Admin-role and URL-slug edge cases: `ui-family-move-manifests.md`.
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

  // Checked BEFORE the remembered-team lookup, not as a fallback after
  // it — a stale shared-team id persisted from an earlier organization
  // page must never win on the personal-workspace pages.
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
  | { readonly key: "projectSlug"; readonly value: string };

/**
 * What the resolution should leave behind — every write is guarded by
 * "differs from what's stored": unguarded, each write's storage event
 * re-renders every reader, tripping React's nested-update limit mid-navigation.
 */
export function uiScopeSelectionWrites({
  resolved,
  selection,
}: {
  resolved: UiResolvedScope;
  selection: UiScopeSelection;
}): UiScopeSelectionWrite[] {
  // The demo project is a visitor's context, not the caller's own work.
  if (resolved.isDemo) return [];

  const writes: UiScopeSelectionWrite[] = [];
  const { organization, team, project } = resolved;

  if (organization && organization.id !== selection.organizationId) {
    writes.push({ key: "organizationId", value: organization.id });
  }

  // "Where was I working" is a question about the organization's teams
  // and projects — a personal workspace isn't one; it resolves from its
  // own address every time, so nothing about it needs remembering.
  if (!team?.isPersonal) {
    if (team && team.id !== selection.teamId) {
      writes.push({ key: "teamId", value: team.id });
    }
    if (project && project.slug !== selection.projectSlug) {
      writes.push({ key: "projectSlug", value: project.slug });
    }
  }

  return writes;
}
