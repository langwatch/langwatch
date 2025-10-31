import { useRouter } from "next/router";
import { useEffect, useMemo } from "react";
import { useLocalStorage } from "usehooks-ts";

import {
  organizationRolePermissionMapping,
  type OrganizationRoleGroup,
  type TeamRoleGroup,
  teamRolePermissionMapping,
} from "../server/api/permission";
import { api } from "../utils/api";

import { type OrganizationUserRole } from "@prisma/client";
import { usePublicEnv } from "./usePublicEnv";
import { publicRoutes, useRequiredSession } from "./useRequiredSession";
import {
  teamRoleHasPermission,
  organizationRoleHasPermission,
  hasPermissionWithHierarchy,
  type Permission,
} from "../server/api/rbac";

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

  const router = useRouter();
  const publicEnv = usePublicEnv();

  const isPublicRoute = publicRoutes.includes(router.route);
  const shareId = typeof router.query.id === "string" ? router.query.id : "";
  const publicShare = api.share.getShared.useQuery(
    { id: shareId },
    { enabled: !!shareId && !!isPublicRoute },
  );
  const publicShareProject = api.project.publicGetById.useQuery(
    {
      id: publicShare.data?.projectId ?? "",
      shareId: publicShare.data?.id ?? "",
    },
    { enabled: !!publicShare.data?.projectId && !!publicShare.data?.id },
  );

  const isDemo = Boolean(
    publicEnv.data?.DEMO_PROJECT_SLUG &&
      router.query.project === publicEnv.data.DEMO_PROJECT_SLUG,
  );

  const organizations = api.organization.getAll.useQuery(
    { isDemo: isDemo },
    {
      enabled: !!session.data || !isPublicRoute,
      staleTime: keepFetching ? undefined : Infinity,
      refetchInterval: keepFetching ? 5_000 : undefined,
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

  const reservedProjectSlugs = useMemo(
    () => ["analytics", "datasets", "evaluations", "experiments", "messages"],
    [],
  );

  const projectQueryParam =
    typeof router.query.project == "string" ? router.query.project : undefined;

  // TODO: test all this
  const projectSlug =
    projectQueryParam && !reservedProjectSlugs.includes(projectQueryParam)
      ? projectQueryParam
      : localStorageProjectSlug;

  const teamSlug =
    typeof router.query.team == "string" ? router.query.team : undefined;

  const teamsMatchingSlug = teamSlug
    ? organizations.data?.flatMap((organization) =>
        organization.teams
          .filter((team) => team.slug === teamSlug)
          .map((team) => ({ organization, team })),
      )
    : undefined;

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

  const organization = teamsMatchingSlug?.[0]
    ? teamsMatchingSlug?.[0].organization
    : projectsTeamsOrganizationsMatchingSlug?.[0]
    ? projectsTeamsOrganizationsMatchingSlug?.[0].organization
    : organizations.data
    ? organizations.data.find((org) => org.id == localStorageOrganizationId) ??
      organizations.data[0]
    : undefined;

  const team = projectsTeamsOrganizationsMatchingSlug?.[0]
    ? projectsTeamsOrganizationsMatchingSlug?.[0].team
    : organization
    ? organization.teams.find((team) => team.id == localStorageTeamId) ??
      organization.teams.find((team) => team.projects.length > 0) ??
      organization.teams[0]
    : undefined;

  const project = team
    ? projectsTeamsOrganizationsMatchingSlug?.[0]?.project ?? team.projects[0]
    : undefined;

  const modelProviders = api.modelProvider.getAllForProject.useQuery(
    { projectId: project?.id ?? "" },
    {
      enabled: !!project?.id,
      refetchOnMount: false,
      refetchOnWindowFocus: true,
    },
  );

  useEffect(() => {
    if (organization && organization.id !== localStorageOrganizationId) {
      setLocalStorageOrganizationId(organization.id);
    }
    if (team && team.id !== localStorageTeamId) {
      setLocalStorageTeamId(team.id);
    }
    if (project && project.slug !== localStorageProjectSlug) {
      setLocalStorageProjectSlug(project.slug);
    }
    // We want to update localstorage values only once, forward, doesn't matter if localstorage
    // itself changes. This is because the user might have two tabs open in different projects,
    // and we don't want them fighting each other on who keeps localstorage in sync.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organization, project, team]);

  useEffect(() => {
    if (
      projectQueryParam &&
      reservedProjectSlugs.includes(projectQueryParam) &&
      project
    ) {
      void router.push(`/${project.slug}/${projectQueryParam}`);
      return;
    }

    if (publicRoutes.includes(router.route)) return;
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
    if (!organization || !teamsWithProjectsOnAnyOrg.length) {
      void router.push(`/onboarding/welcome${returnTo}`);
      return;
    }

    const hasTeamsWithProjectsOnCurrentOrg = organization.teams.some(
      (team) => team.projects.length > 0,
    );
    if (
      !hasTeamsWithProjectsOnCurrentOrg &&
      teamsWithProjectsOnAnyOrg.length > 0
    ) {
      const availableProjectSlug =
        teamsWithProjectsOnAnyOrg[0]!.projects[0]!.slug;
      void router.push(`/${availableProjectSlug}`);
      return;
    }

    if (redirectToProjectOnboarding && !teamsWithProjectsOnAnyOrg.length) {
      const firstTeamSlug = organizations.data.flatMap((org) => org.teams)[0]
        ?.slug;
      void router.push(`/onboarding/${firstTeamSlug}/project${returnTo}`);
      return;
    }

    if (
      project &&
      typeof router.query.project == "string" &&
      project.slug !== router.query.project
    ) {
      const returnTo = router.query.return_to;
      const returnToParam = returnTo
        ? `?return_to=${encodeURIComponent(returnTo as string)}`
        : "";
      void router.push(`/${project.slug}${returnToParam}`);
    }
  }, [
    organization,
    organizations.data,
    project,
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
      project: publicShareProject.data,
      // Legacy API
      hasTeamPermission: () => false,
      hasOrganizationPermission: () => false,
      // New RBAC API
      hasPermission: () => false,
      hasOrgPermission: () => false,
      hasAnyPermission: () => false,
      isPublicRoute,
      isOrganizationFeatureEnabled: () => false,
    };
  }

  const organizationRole = organization?.members[0]?.role;

  const hasOrganizationPermission = (
    roleGroup: keyof typeof OrganizationRoleGroup,
  ) => {
    return !!(
      organizationRole &&
      (
        organizationRolePermissionMapping[roleGroup] as OrganizationUserRole[]
      ).includes(organizationRole)
    );
  };

  const hasTeamPermission = (
    roleGroup: keyof typeof TeamRoleGroup,
    team_ = team,
  ) => {
    const teamRole = team_?.members[0]?.role;
    const allowedRoles = teamRolePermissionMapping[roleGroup];
    return !!(teamRole && allowedRoles && allowedRoles.includes(teamRole));
  };

  const isOrganizationFeatureEnabled = (feature: string): boolean => {
    if (!organization?.features) return false;
    const trialFeature = organization.features.find(
      (f) => f.feature === feature,
    );
    if (!trialFeature) return false;

    if (!trialFeature.trialEndDate) return true;
    return new Date(trialFeature.trialEndDate) > new Date();
  };

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
    // Check if this is an organization permission
    const isOrgPermission = permission.startsWith("organization:");

    if (isOrgPermission) {
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
    const teamMember = team?.members[0];
    if (!teamMember) return false;

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
    project: publicShareProject.data ?? project,
    projectId: project?.id,
    // Legacy permission API (still supported)
    hasOrganizationPermission,
    hasTeamPermission,
    // New RBAC permission API (preferred)
    hasPermission,
    hasOrgPermission,
    hasAnyPermission, // Unified API that auto-routes between org and team permissions
    isPublicRoute,
    modelProviders: modelProviders.data,
    isOrganizationFeatureEnabled,
  };
};
