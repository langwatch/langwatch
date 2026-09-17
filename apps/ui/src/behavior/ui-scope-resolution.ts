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

type UiTeamMatch = Pick<UiSlugMatch, "organization" | "team">;

function resolveOrganization({
  isDemo,
  demoProjectSlug,
  organizations,
  teamsMatchingSlug,
  resolvedSlugMatch,
  selectedOrganizationId,
}: {
  isDemo: boolean;
  demoProjectSlug: string | undefined;
  organizations: readonly UiScopeOrganization[] | undefined;
  teamsMatchingSlug: readonly UiTeamMatch[] | undefined;
  resolvedSlugMatch: UiSlugMatch | undefined;
  selectedOrganizationId: string | undefined;
}): UiScopeOrganization | undefined {
  if (isDemo) {
    return (
      organizations?.find((candidate) =>
        candidate.teams.some((team) =>
          team.projects.some((project) => project.slug === demoProjectSlug),
        ),
      ) ?? organizations?.[0]
    );
  }
  if (teamsMatchingSlug?.[0]) return teamsMatchingSlug[0].organization;
  if (resolvedSlugMatch) return resolvedSlugMatch.organization;
  return (
    organizations?.find((candidate) => candidate.id === selectedOrganizationId) ??
    organizations?.[0]
  );
}

function resolveTeam({
  isDemo,
  demoProjectSlug,
  organization,
  resolvedSlugMatch,
  ownPersonalTeam,
  rememberedTeam,
  userId,
}: {
  isDemo: boolean;
  demoProjectSlug: string | undefined;
  organization: UiScopeOrganization | undefined;
  resolvedSlugMatch: UiSlugMatch | undefined;
  ownPersonalTeam: UiScopeTeam | undefined;
  rememberedTeam: UiScopeTeam | undefined;
  userId: string | undefined;
}): UiScopeTeam | undefined {
  if (isDemo) {
    return (
      organization?.teams.find((candidate) =>
        candidate.projects.some((project) => project.slug === demoProjectSlug),
      ) ?? selectAmbientTeam({ teams: organization?.teams ?? [], userId })
    );
  }
  if (resolvedSlugMatch) return resolvedSlugMatch.team;
  if (ownPersonalTeam) return ownPersonalTeam;
  if (!organization) return void 0;
  return rememberedTeam ?? selectAmbientTeam({ teams: organization.teams, userId });
}

function resolveProject({
  isDemo,
  demoProjectSlug,
  team,
  resolvedSlugMatch,
}: {
  isDemo: boolean;
  demoProjectSlug: string | undefined;
  team: UiScopeTeam | undefined;
  resolvedSlugMatch: UiSlugMatch | undefined;
}): UiScopeProject | undefined {
  if (isDemo) {
    return (
      team?.projects.find((candidate) => candidate.slug === demoProjectSlug) ?? team?.projects[0]
    );
  }
  if (!team) return void 0;
  return resolvedSlugMatch?.project ?? team.projects[0];
}

function findTeamsBySlug(
  organizations: readonly UiScopeOrganization[] | undefined,
  teamSlug: string | undefined,
): UiTeamMatch[] | undefined {
  if (!teamSlug) return void 0;
  return organizations?.flatMap((organization) =>
    organization.teams
      .filter((team) => team.slug === teamSlug)
      .map((team) => ({ organization, team })),
  );
}

function compareProjectMatches(
  a: UiSlugMatch,
  b: UiSlugMatch,
  selection: UiScopeSelection,
): number {
  if (a.organization.id === selection.organizationId) return -1;
  if (b.organization.id === selection.organizationId) return 1;
  if (a.team.id === selection.teamId) return -1;
  if (b.team.id === selection.teamId) return 1;
  return 0;
}

function findProjectsBySlug({
  organizations,
  teamsMatchingSlug,
  projectSlug,
  selection,
}: {
  organizations: readonly UiScopeOrganization[] | undefined;
  teamsMatchingSlug: readonly UiTeamMatch[] | undefined;
  projectSlug: string | undefined;
  selection: UiScopeSelection;
}): UiSlugMatch[] {
  return (
    organizations?.flatMap((organization) => {
      const teams = teamsMatchingSlug?.[0]
        ? teamsMatchingSlug.map(({ team }) => team)
        : organization.teams;
      return teams.flatMap((team) =>
        team.projects
          .filter((project) => project.slug === projectSlug)
          .map((project) => ({ organization, project, team }))
          .sort((a, b) => compareProjectMatches(a, b, selection)),
      );
    }) ?? []
  );
}

function selectUsableSlugMatch({
  matches,
  userId,
  isAddressedBySlug,
  isPersonalScopeRoute,
}: {
  matches: readonly UiSlugMatch[];
  userId: string | undefined;
  isAddressedBySlug: boolean;
  isPersonalScopeRoute: boolean;
}): UiSlugMatch | undefined {
  const membershipMatch = userId
    ? matches.find((match) => userBelongsToTeam(match.team, userId))
    : void 0;
  const match = membershipMatch ?? matches[0];
  if (!match || isAddressedBySlug) return match;
  if (isPersonalScopeRoute || match.team.isPersonal) return void 0;
  const canOpen = userCanOpenTeam({
    team: match.team,
    userId,
    organizationRole: organizationRoleOf(match.organization),
  });
  return canOpen ? match : void 0;
}

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

  const teamsMatchingSlug = findTeamsBySlug(organizations, teamSlug);

  // The address bar separates "the user is in their personal workspace"
  // from "the app picked it for them": a URL slug resolves like any
  // other, but the persisted selection does not (see the stickiness rule
  // in `ui-family-move-manifests.md`).
  const isAddressedBySlug = !!projectSlugFromUrl || !!teamsMatchingSlug?.[0];

  const slugMatches = findProjectsBySlug({
    organizations,
    teamsMatchingSlug,
    projectSlug,
    selection,
  });
  const resolvedSlugMatch = selectUsableSlugMatch({
    matches: slugMatches,
    userId,
    isAddressedBySlug,
    isPersonalScopeRoute: route.isPersonalScopeRoute,
  });

  const isDemo = Boolean(demoProjectSlug && projectParam === demoProjectSlug);

  // In demo mode the reply carries the caller's own organizations AND the demo
  // one, so the demo organization is found by the project it holds.
  const organization = resolveOrganization({
    isDemo,
    demoProjectSlug,
    organizations,
    teamsMatchingSlug,
    resolvedSlugMatch,
    selectedOrganizationId: selection.organizationId,
  });

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

  const team = resolveTeam({
    isDemo,
    demoProjectSlug,
    organization,
    resolvedSlugMatch,
    ownPersonalTeam,
    rememberedTeam,
    userId,
  });

  const project = resolveProject({ isDemo, demoProjectSlug, team, resolvedSlugMatch });

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

/**
 * The `?org=<slug>` switch clears remembered team/project so the new org's defaults apply.
 * Spec: specs/ai-gateway/governance/org-query-param-switch.feature
 */
export function uiOrgQueryParamWrites({
  orgParam,
  organizations,
  selection,
}: {
  readonly orgParam: string;
  /** Undefined until `organization.getAll` has answered; membership cannot be judged before. */
  readonly organizations: readonly Pick<UiScopeOrganization, "id" | "slug">[] | undefined;
  readonly selection: UiScopeSelection;
}): UiScopeSelectionWrite[] {
  if (!orgParam || !organizations) return [];

  const match = organizations.find((organization) => organization.slug === orgParam);
  if (!match || match.id === selection.organizationId) return [];

  return [
    { key: "organizationId", value: match.id },
    { key: "teamId", value: "" },
    { key: "projectSlug", value: "" },
  ];
}
