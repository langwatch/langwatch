import { useEffect, useMemo } from "react";
import { useLocalStorage } from "usehooks-ts";
import { useNavigationModeStore } from "~/features/navigation/navigationModeStore";
import { OrganizationUserRole, type Project } from "~/generated/prisma/client";
import { useRouter } from "~/utils/compat/next-router";
import {
  EXTERNAL_MEMBER_PERMISSIONS,
  hasPermissionWithHierarchy,
  organizationRoleHasPermission,
  type Permission,
  teamRoleHasPermission,
} from "../server/api/rbac";
import { api } from "../utils/api";
import { usePublicEnv } from "./usePublicEnv";
import {
  noOrgBouncerRoutes,
  publicRoutes,
  useRequiredSession,
} from "./useRequiredSession";

/**
 * Whether a permission is org-scoped: it lives in ORGANIZATION_ROLE_PERMISSIONS
 * and must be resolved against the user's organization role, not any team-role
 * bag. Covers `organization:` itself plus the AI Governance resource family
 * (governance / ingestionSources / anomalyRules / complianceExport /
 * activityMonitor / aiTools). Team admins do NOT inherit these automatically;
 * delegation flows through the CustomRolePermissions JSON column at the team
 * level (matching the rest of the RBAC catalog).
 *
 * @internal Exported for testing only
 */
export function isOrgScopedPermission(permission: Permission): boolean {
  return (
    permission.startsWith("organization:") ||
    permission.startsWith("governance:") ||
    permission.startsWith("ingestionSources:") ||
    permission.startsWith("anomalyRules:") ||
    permission.startsWith("complianceExport:") ||
    permission.startsWith("activityMonitor:") ||
    permission.startsWith("aiTools:") ||
    // Webhook endpoints and the spend record are org-tier resources
    // (rbac.ts ADMIN defaults); resolving them against team roles denies
    // org admins client-side while the server correctly allows them.
    permission.startsWith("webhookEndpoints:") ||
    permission.startsWith("gatewaySpend:")
  );
}

/**
 * Whether the caller holds a membership on this team.
 *
 * `organization.getAll` returns every team in the organization but narrows
 * `team.members` to the caller's own row, synthesizing one from a RoleBinding
 * when the legacy TeamUser row is absent.
 *
 * Shared with `DashboardLayout`, which gates the page body on it: the team the
 * ambient resolution picks and the team the chrome will render for have to be
 * decided the same way, or the app resolves a context it then refuses.
 */
export function userBelongsToTeam<T extends { members?: { userId: string }[] }>(
  team: T,
  userId: string,
): boolean {
  return team.members?.some((member) => member.userId === userId) ?? false;
}
/**
 * Ambient team for organization-level work.
 *
 * Membership decides first. The teams list carries the whole organization,
 * not just the caller's corner of it, so any preference expressed purely as
 * "the first team shaped like X" hands members a team they are not on the
 * moment an organization has more than one. The chrome then refuses the page
 * outright with "You are not part of any team in this organization", and the
 * settings surfaces that write against the ambient project aim at a project
 * in someone else's team.
 *
 * Within the teams the caller does belong to, the order of preference is: a
 * shared team that already holds a project, then any shared team, then
 * whatever is left.
 *
 * Personal workspaces sort last because they are a private context — one
 * project, owned by one person — while everything the app scopes to the
 * ambient project belongs to the organization. Model provider credentials are
 * the sharp edge: the settings page writes them against the ambient project,
 * so a personal workspace winning here files an organization's keys into one
 * member's private space. A personal team always holds exactly one project,
 * so a plain "first team with a project" lookup lets it win whenever it
 * sorts first.
 *
 * An organization whose only team is personal still resolves to it, so a solo
 * user is never left without a context. Someone who belongs to no team at all
 * falls through to the same preference order over every team, which keeps the
 * chrome on a resolved context so it can render the refusal instead of
 * hanging on a loading screen forever.
 *
 * @internal Exported for testing only
 */
export function selectAmbientTeam<
  T extends {
    isPersonal?: boolean | null;
    projects: unknown[];
    members?: { userId: string }[];
  },
>(teams: T[], userId?: string): T | undefined {
  const byPreference = (candidates: T[]) =>
    candidates.find((team) => !team.isPersonal && team.projects.length > 0) ??
    candidates.find((team) => !team.isPersonal) ??
    candidates.find((team) => team.projects.length > 0) ??
    candidates[0];

  const own = userId
    ? teams.filter((team) => userBelongsToTeam(team, userId))
    : teams;

  return byPreference(own) ?? byPreference(teams);
}

/** @internal Exported for testing only */
export function resolveProjectRedirectSubPath({
  pathname,
  oldProject,
}: {
  pathname: string;
  oldProject: string;
}): string {
  const decodedPrefix = `/${oldProject}`;
  const encodedPrefix = `/${encodeURIComponent(oldProject)}`;

  const matchSegmentPrefix = (prefix: string): string | null => {
    if (!pathname.startsWith(prefix)) return null;
    const rest = pathname.slice(prefix.length);
    if (rest !== "" && !rest.startsWith("/")) return null;
    return rest;
  };

  return (
    matchSegmentPrefix(decodedPrefix) ?? matchSegmentPrefix(encodedPrefix) ?? ""
  );
}

export const useOrganizationTeamProject = (
  {
    redirectToOnboarding,
    redirectToProjectOnboarding,
    keepFetching,
  }: {
    redirectToOnboarding?: boolean;
    redirectToProjectOnboarding?: boolean;
    keepFetching?: boolean;
  } = {
    redirectToOnboarding: true,
    redirectToProjectOnboarding: true,
    keepFetching: false,
  },
) => {
  const session = useRequiredSession();
  const userId = session.data?.user.id;

  const router = useRouter();
  const publicEnv = usePublicEnv();

  const isPublicRoute = publicRoutes.includes(router.route);
  const shareToken = typeof router.query.id === "string" ? router.query.id : "";
  // The public share page resolves everything (incl. its project chrome) through
  // the single `sharedTrace.get` read. Same query key as the page, so React
  // Query dedupes to one request and one consumed view. See ADR-057.
  const sharedTrace = api.sharedTrace.get.useQuery(
    { token: shareToken },
    {
      enabled: !!shareToken && !!isPublicRoute,
      staleTime: Infinity,
      retry: false,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  );
  const publicShareProjectData: Project | undefined = sharedTrace.data
    ? {
        // The share payload deliberately exposes only the chrome fields; take
        // exactly those off the DTO.
        id: sharedTrace.data.project.id,
        name: sharedTrace.data.project.name,
        slug: sharedTrace.data.project.slug,
        language: sharedTrace.data.project.language,
        framework: sharedTrace.data.project.framework,
        // Everything else is stubbed with inert, non-sensitive defaults so the
        // object satisfies the full `Project` the app chrome is typed against.
        // Nothing session-gated runs on public routes, so these are never read
        // for real decisions; sensitive fields (apiKey, teamId, S3 credentials)
        // stay empty/null rather than fake. The explicit `Project` annotation
        // (no `as` cast) makes the compiler flag any new required column, so a
        // future field can never silently ship unset here. See ADR-057.
        apiKey: "",
        governedSqlKey: "",
        teamId: "",
        kind: "application",
        firstMessage: true,
        integrated: false,
        createdAt: new Date(0),
        updatedAt: new Date(0),
        userLinkTemplate: null,
        traceSharingEnabled: false,
        presenceEnabled: false,
        s3Endpoint: null,
        s3AccessKeyId: null,
        s3SecretAccessKey: null,
        s3Bucket: null,
        archivedAt: null,
        isPersonal: false,
        ownerUserId: null,
        personalFeatures: {},
        // `null` = no egress allowlist configured, which the Langy credential
        // service reads as "no custom egress" rather than "allow anything" —
        // the fail-closed side of ADR-053. A share viewer never runs Langy, so
        // this is inert either way; null keeps it inert AND safe.
        langyEgressAllowlist: null,
        departmentId: null,
        // A share viewer gets no project rail, and these two columns exist only
        // to grow destinations on it. `null` reads as "no coding-agent signal",
        // which is both inert and true of the view a share token opens.
        lastCodingAgentSessionAt: null,
        lastCodingAgentPullRequestAt: null,
      }
    : undefined;

  const isDemo = Boolean(
    publicEnv.data?.DEMO_PROJECT_SLUG &&
      router.query.project === publicEnv.data.DEMO_PROJECT_SLUG,
  );

  const organizations = api.organization.getAll.useQuery(
    { isDemo: isDemo },
    {
      enabled: !!session.data || !isPublicRoute,
      // Small reference query that drives load-bearing client state (current
      // project incl. defaultModel). Cheap to refetch — prefer freshness over
      // a "cache forever" default. Background refetch on focus picks up edits
      // made via SDK, API, or another tab.
      staleTime: keepFetching ? 0 : 30_000,
      refetchOnWindowFocus: true,
      refetchInterval: keepFetching ? 5_000 : undefined,
      // Skip the HTTP batch link: this query is mounted at the app shell and
      // refetches on focus/route change, so left in the batch it would drag
      // the drawer-open burst (organization.getAll + 7 trace procedures —
      // measured at ~2.5s, blocked by the slowest). On its own connection it
      // runs in parallel without affecting the trace fan-out.
      trpc: { context: { skipBatch: true } },
    },
  );

  const [localStorageOrganizationId, setLocalStorageOrganizationId] =
    useLocalStorage<string>("selectedOrganizationId", "");
  const [localStorageTeamId, setLocalStorageTeamId] = useLocalStorage<string>(
    "selectedTeamId",
    "",
  );
  const [localStorageProjectSlug, setLocalStorageProjectSlug] =
    useLocalStorage<string>("selectedProjectSlug", "");
  const [lastVisitedHomeKind, setLastVisitedHomeKind] = useLocalStorage<
    "" | "project" | "personal"
  >("lastVisitedHomeKind", "");

  const reservedProjectSlugs = useMemo(
    () => ["analytics", "datasets", "evaluations", "experiments", "messages"],
    [],
  );

  const projectQueryParam =
    typeof router.query.project == "string" ? router.query.project : undefined;

  // TODO: test all this
  const projectSlugFromUrl =
    projectQueryParam && !reservedProjectSlugs.includes(projectQueryParam)
      ? projectQueryParam
      : undefined;

  const projectSlug = projectSlugFromUrl ?? localStorageProjectSlug;

  const teamSlug =
    typeof router.query.team == "string" ? router.query.team : undefined;

  const teamsMatchingSlug = teamSlug
    ? organizations.data?.flatMap((organization) =>
        organization.teams
          .filter((team) => team.slug === teamSlug)
          .map((team) => ({ organization, team })),
      )
    : undefined;

  // The address bar is what separates "the user is in their personal
  // workspace" from "the app picked it for them". A personal project or team
  // named in the URL resolves exactly like any other; the persisted selection
  // does not, because nothing on an organization-scoped page tells the user
  // which project it is about to write to. A `?team=` that resolves to no team
  // the user can see addresses nothing, so it stays out of the predicate.
  const isAddressedBySlug = !!projectSlugFromUrl || !!teamsMatchingSlug?.[0];

  const projectsTeamsOrganizationsMatchingSlug = organizations.data?.flatMap(
    (organization) =>
      (teamsMatchingSlug?.[0]
        ? teamsMatchingSlug.map(({ team }) => team)
        : organization.teams
      ).flatMap((team) =>
        team.projects
          .filter((project) => project.slug == projectSlug)
          .map((project) => ({ organization, project, team }))
          .sort((a, b) => {
            // slugs can be duplicate accross teams and project, so multiple could match
            // prioritize those projects that match also org and team localstorage ids
            if (a.organization.id == localStorageOrganizationId) return -1;
            if (b.organization.id == localStorageOrganizationId) return 1;
            if (a.team.id == localStorageTeamId) return -1;
            if (b.team.id == localStorageTeamId) return 1;
            return 0;
          }),
      ),
  );

  // A slug can name a project in more than one team, so prefer a match on a
  // team the caller is on before falling back to the first one.
  const slugMatches = projectsTeamsOrganizationsMatchingSlug ?? [];
  const slugMatch =
    (userId
      ? slugMatches.find((match) => userBelongsToTeam(match.team, userId))
      : undefined) ?? slugMatches[0];

  // A slug that resolved off the persisted selection rather than off the URL
  // is stickiness, not intent: it survives from the last visit to
  // /[some-slug]/* into every organization-scoped page that carries no project
  // of its own. Two kinds have to be dropped there. A personal workspace is a
  // private context the caller never asked to work in, and a team the caller
  // does not belong to is one the chrome refuses outright. Both let the
  // ambient resolution below pick again, which also re-persists what it picks
  // so the stale selection heals itself.
  //
  // A slug named in the address bar keeps resolving exactly as before,
  // including into a team the caller is not on: the refusal that follows is
  // the honest answer to typing someone else's project into the URL.
  const stickySlugIsUnusable =
    !!slugMatch &&
    !isAddressedBySlug &&
    (!!slugMatch.team.isPersonal ||
      (!!userId && !userBelongsToTeam(slugMatch.team, userId)));
  const resolvedSlugMatch = stickySlugIsUnusable ? undefined : slugMatch;

  // For demo mode, find the organization that contains the demo project
  // (backend returns all user orgs + demo org, so we need to find the one with demo project)
  const organization = isDemo
    ? (organizations.data?.find((org) =>
        org.teams.some((team) =>
          team.projects.some(
            (project) => project.slug === publicEnv.data?.DEMO_PROJECT_SLUG,
          ),
        ),
      ) ?? organizations.data?.[0]) // Fallback to first if not found
    : teamsMatchingSlug?.[0]
      ? teamsMatchingSlug?.[0].organization
      : resolvedSlugMatch
        ? resolvedSlugMatch.organization
        : organizations.data
          ? (organizations.data.find(
              (org) => org.id == localStorageOrganizationId,
            ) ?? organizations.data[0])
          : undefined;

  // `/me` and its sub-routes are the one place "no project slug in the URL"
  // does NOT mean "organization-level work", it means the user's own
  // personal workspace, the opposite of the ambient/shared team `selectAmbientTeam`
  // exists to prefer. Checked BEFORE the localStorage-remembered-team lookup,
  // not just added as a further fallback after it: a member who visited any
  // organization-scoped page earlier in the session has a non-personal team
  // id already persisted there, and that stale selection legitimately wins
  // on THOSE pages (see the stickiness handling above) but must never win on
  // /me itself, which is unambiguously about the personal workspace and
  // cannot mean anything else. Left as a fallback-only check, that persisted
  // selection matched before this was ever reached, and /me resolved to the
  // shared team's first (or, if it holds no project yet, undefined) project,
  // which then read every personal-scope feature (Langy chief among them) as
  // running in a context that either belonged to someone else or did not
  // exist. Gated on the same `/me` prefix DashboardLayout already uses for
  // `isPersonalScopeRoute`, so every other caller (settings pages,
  // project-slug pages, demo mode) is unaffected.
  const isPersonalScopeRoute = router.pathname.startsWith("/me");
  const ownPersonalTeam = isPersonalScopeRoute
    ? organization?.teams.find(
        (team) => team.isPersonal && team.ownerUserId === userId,
      )
    : undefined;

  // The remembered selection carries the same membership requirement as the
  // ambient pick below. Without it a persisted team id keeps resolving a team
  // the caller is not on, long after the resolution itself stopped producing
  // one: the selection is written from whatever last resolved, so a bad pick
  // outlives the page that made it.
  const rememberedTeam = organization?.teams.find(
    (team) =>
      team.id == localStorageTeamId &&
      !team.isPersonal &&
      (!userId || userBelongsToTeam(team, userId)),
  );

  const team = isDemo
    ? (organization?.teams.find((t) =>
        t.projects.some(
          (project) => project.slug === publicEnv.data?.DEMO_PROJECT_SLUG,
        ),
      ) ?? selectAmbientTeam(organization?.teams ?? [], userId)) // The team holding the demo project, else the ambient one
    : resolvedSlugMatch
      ? resolvedSlugMatch.team
      : ownPersonalTeam
        ? ownPersonalTeam
        : organization
          ? (rememberedTeam ?? selectAmbientTeam(organization.teams, userId))
          : undefined;

  // For demo mode, find the project with the demo slug
  const project = isDemo
    ? (team?.projects.find(
        (p) => p.slug === publicEnv.data?.DEMO_PROJECT_SLUG,
      ) ?? team?.projects[0]) // Find demo project by slug, or fallback to first
    : team
      ? (resolvedSlugMatch?.project ?? team.projects[0])
      : undefined;

  // Override project slug for demo projects so it matches the URL
  const finalProject = useMemo(() => {
    if (isDemo && project) {
      return { ...project, slug: publicEnv.data?.DEMO_PROJECT_SLUG ?? "demo" };
    }
    return project;
  }, [isDemo, project, publicEnv.data?.DEMO_PROJECT_SLUG]);

  const modelProviders = api.modelProvider.getAllForProject.useQuery(
    { projectId: finalProject?.id ?? "" },
    {
      enabled: !!finalProject?.id,
      refetchOnMount: false,
      refetchOnWindowFocus: true,
    },
  );

  useEffect(() => {
    // Don't update localStorage for demo projects
    if (isDemo) return;

    if (organization && organization.id !== localStorageOrganizationId) {
      setLocalStorageOrganizationId(organization.id);
    }
    if (team && team.id !== localStorageTeamId) {
      setLocalStorageTeamId(team.id);
    }
    if (project && project.slug !== localStorageProjectSlug) {
      setLocalStorageProjectSlug(project.slug);
    }
    // Visiting an actual /[project]/* page marks the implicit home preference
    // as "project". Pairs with MyLayout's "personal" marker so the `/` index
    // resolver can fall through to whichever home was visited last when the
    // user has no explicit pin. Gate on the URL actually carrying a project
    // slug: `project` also resolves from the persisted selectedProjectSlug on
    // non-project routes (e.g. /me), and marking "project" there would clobber
    // MyLayout's "personal" and wrongly bounce `/` back to the project.
    // `projectSlugFromUrl` (not raw `router.query.project`) so reserved slugs
    // like /messages or /datasets don't count as project visits either.
    if (project && !!projectSlugFromUrl && lastVisitedHomeKind !== "project") {
      // Guarded like the setters above: every unguarded write dispatches a
      // storage event that setStates all mounted subscribers, which can cascade
      // past React's nested-update limit during route transitions.
      setLastVisitedHomeKind("project");
    }
    // We want to update localstorage values only once, forward, doesn't matter if localstorage
    // itself changes. This is because the user might have two tabs open in different projects,
    // and we don't want them fighting each other on who keeps localstorage in sync.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDemo, organization, project, team, router.query.project]);

  useEffect(() => {
    if (
      projectQueryParam &&
      reservedProjectSlugs.includes(projectQueryParam) &&
      finalProject
    ) {
      void router.push(`/${finalProject.slug}/${projectQueryParam}`);
      return;
    }

    // Skip all redirect logic for demo projects
    if (isDemo) return;

    if (publicRoutes.includes(router.route)) return;
    // Routes like /invite/accept and /onboarding/* require auth but
    // shouldn't bounce zero-org users to /onboarding/welcome — see
    // `noOrgBouncerRoutes` for the rationale (iter 47 invite race fix).
    if (noOrgBouncerRoutes.includes(router.route)) return;
    if (!redirectToOnboarding) return;
    if (!organizations.data) return;

    const currentPath = router.pathname;
    const redirectBackPaths = ["/authorize"];
    const returnTo = redirectBackPaths.includes(currentPath)
      ? `?return_to=${currentPath}`
      : "";

    const teamsWithProjectsOnAnyOrg = organizations.data.flatMap((org) =>
      org.teams.filter((team) => team.projects.length > 0),
    );

    // Onboarding is for people who belong to no organization. It is the page
    // that creates one, so offering it to a member only ever produces a second
    // organization nobody asked for, and `pages/index.tsx` already draws the
    // line here.
    if (organizations.data.length === 0) {
      void router.push(`/onboarding/welcome${returnTo}`);
      return;
    }

    // ADR-038 v6: an intent-set org is onboarded, period. Governance orgs
    // deliberately have no project (users live on /me, data flows through
    // personal workspaces); an LLMOps org that postponed project creation
    // recovers via /settings. Never redirect either to another org's project.
    if (organization?.primaryIntent) {
      return;
    }

    // A member with nothing to be redirected *to* stays put, and the home
    // resolver in `pages/index.tsx` picks their destination. This used to bounce
    // to onboarding, which is how a member invited into an organization with no
    // shared project ended up at "let's kick off by creating your organization".
    // Note `teamsWithProjectsOnAnyOrg` counts personal workspaces, so a member
    // who has only their own workspace reaches here rather than the branch
    // below, which is deliberate: a personal workspace is never a project-home
    // target (ADR-038 v6).
    if (!organization || !teamsWithProjectsOnAnyOrg.length) {
      return;
    }

    const hasTeamsWithProjectsOnCurrentOrg = organization.teams.some(
      (team) => team.projects.length > 0,
    );
    if (
      !hasTeamsWithProjectsOnCurrentOrg &&
      teamsWithProjectsOnAnyOrg.length > 0 &&
      // In the navigation-v2 modes the org switch and the landing resolver
      // own cross-organization destinations; this teleport to another
      // org's project would fight them mid-navigation. Read fresh from the
      // store (not subscribed) so legacy devices stay on the exact current
      // code path. Spec: specs/navigation/navigation-v2-landing.feature
      useNavigationModeStore.getState().storedMode === "legacy"
    ) {
      // Personal workspaces are never a valid project-home target — only
      // redirect when a shared team's project exists (ADR-038 v6).
      const availableProjectSlug = teamsWithProjectsOnAnyOrg.find(
        (team) => !team.isPersonal,
      )?.projects[0]?.slug;
      if (availableProjectSlug) {
        void router.push(`/${availableProjectSlug}`);
        return;
      }
    }

    if (redirectToProjectOnboarding && !teamsWithProjectsOnAnyOrg.length) {
      const firstTeamSlug = organizations.data.flatMap((org) => org.teams)[0]
        ?.slug;
      void router.push(`/onboarding/${firstTeamSlug}/project${returnTo}`);
      return;
    }

    if (
      finalProject &&
      typeof router.query.project == "string" &&
      finalProject.slug !== router.query.project
    ) {
      // Preserve the sub-path so /bad-slug/messages → /good-slug/messages
      // query.project is decoded by React Router (%5Bproject%5D → [project]),
      // but asPath keeps percent-encoding. Match both forms, always slice from
      // the original encoded pathname to avoid decoding characters in the sub-path.
      const url = new URL(router.asPath, window.location.origin);
      const subPath = resolveProjectRedirectSubPath({
        pathname: url.pathname,
        oldProject: router.query.project as string,
      });
      void router.push(`/${finalProject.slug}${subPath}${url.search}`);
    }
  }, [
    isDemo,
    organization,
    organizations.data,
    finalProject,
    projectQueryParam,
    redirectToOnboarding,
    redirectToProjectOnboarding,
    reservedProjectSlugs,
    router,
    team,
  ]);

  if (organizations.isLoading && !organizations.isFetched) {
    return {
      isLoading: true,
      project: publicShareProjectData,
      hasPermission: () => false,
      hasOrgPermission: () => false,
      hasAnyPermission: () => false,
      isPublicRoute,
      isDemo,
      organizationRole: undefined,
    };
  }

  const organizationRole = organization?.members?.[0]?.role;

  // ============================================================================
  // NEW RBAC SYSTEM - Preferred API going forward
  // ============================================================================

  /**
   * Check if the user has a specific permission (new RBAC system)
   * Automatically routes between organization and team permissions
   * @example hasPermission("analytics:view")
   * @example hasPermission("organization:manage")
   */
  const hasPermission = (permission: Permission) => {
    // Org-scoped resources resolve against the org role only (see
    // isOrgScopedPermission); team admins do not inherit them automatically.
    if (isOrgScopedPermission(permission)) {
      // Only check organization role - team admins do NOT get automatic organization permissions
      if (organizationRole) {
        const orgResult = organizationRoleHasPermission(
          organizationRole,
          permission,
        );
        if (orgResult) return true;
      }
      return false;
    }

    // Team-level permission checking
    const teamMember = team?.members?.[0];
    if (!teamMember) {
      // Users created via the RoleBinding-only flow (no legacy TeamUser row) still
      // have full team access when they are org admins — mirrors the server-side
      // behaviour where an org-scoped ADMIN RoleBinding grants all permissions.
      return organizationRole === OrganizationUserRole.ADMIN;
    }

    // Check if user has custom role assignment
    if (teamMember.assignedRole) {
      // If user has custom role, ONLY use custom role permissions (no fallback)
      const rawPermissions = teamMember.assignedRole.permissions as
        | string[]
        | null
        | undefined;
      const userPermissions = Array.isArray(rawPermissions)
        ? rawPermissions
        : [];

      return hasPermissionWithHierarchy(userPermissions, permission);
    }

    // EXTERNAL users get restricted defaults instead of full team role permissions
    if (organizationRole === OrganizationUserRole.EXTERNAL) {
      return hasPermissionWithHierarchy(
        EXTERNAL_MEMBER_PERMISSIONS,
        permission,
      );
    }

    // Only fall back to built-in team role if NO custom role exists
    return teamRoleHasPermission(teamMember.role, permission);
  };

  /**
   * Check if the user has an organization permission (new RBAC system)
   * @example hasOrgPermission("organization:manage")
   */
  const hasOrgPermission = (permission: Permission) => {
    // Only check organization role - team admins do NOT get automatic organization permissions
    if (organizationRole) {
      const orgResult = organizationRoleHasPermission(
        organizationRole,
        permission,
      );

      if (orgResult) return true;
    }

    return false;
  };

  /**
   * Unified permission checker that automatically routes to org or team permissions
   * This is the recommended API as it handles the routing logic automatically
   * @example hasAnyPermission("analytics:view")
   * @example hasAnyPermission("organization:manage")
   */
  const hasAnyPermission = (permission: Permission) => {
    // Determine if this is an organization permission or team permission
    const isOrgPermission = permission.startsWith("organization:");
    return isOrgPermission
      ? hasOrgPermission(permission)
      : hasPermission(permission);
  };

  return {
    isLoading: false,
    isRefetching: organizations.isRefetching,
    organizations: organizations.data,
    organization,
    team,
    project: publicShareProjectData ?? finalProject,
    projectId: finalProject?.id,
    hasPermission,
    hasOrgPermission,
    hasAnyPermission,
    isPublicRoute,
    modelProviders: modelProviders.data,
    isDemo,
    organizationRole,
  };
};
