import { useRouter } from "next/router";
import { useEffect, useMemo } from "react";
import { useLocalStorage } from "usehooks-ts";
import { api } from "../utils/api";
import { publicRoutes, useRequiredSession } from "./useRequiredSession";
import {
  organizationRolePermissionMapping,
  type OrganizationRoleGroup,
  type TeamRoleGroup,
  teamRolePermissionMapping,
} from "../server/api/permission";
import type { OrganizationUserRole, TeamUserRole } from "@prisma/client";

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
  }
) => {
  useRequiredSession();
  const router = useRouter();
  const publicEnv = api.publicEnv.useQuery(
    {},
    {
      staleTime: Infinity,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
    }
  );

  const isDemo = router.query.project === publicEnv.data?.DEMO_PROJECT_SLUG;

  const organizations = api.organization.getAll.useQuery(
    { isDemo: isDemo },
    {
      staleTime: keepFetching ? undefined : Infinity,
      refetchInterval: keepFetching ? 5_000 : undefined,
    }
  );

  const [localStorageOrganizationId, setLocalStorageOrganizationId] =
    useLocalStorage<string>("selectedOrganizationId", "");
  const [localStorageTeamId, setLocalStorageTeamId] = useLocalStorage<string>(
    "selectedTeamId",
    ""
  );
  const [localStorageProjectSlug, setLocalStorageProjectSlug] =
    useLocalStorage<string>("selectedProjectSlug", "");

  const reservedProjectSlugs = useMemo(
    () => ["analytics", "datasets", "evaluations", "experiments", "messages"],
    []
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
          .map((team) => ({ organization, team }))
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
          })
      )
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

    if (!organization || !team) {
      void router.push(`/onboarding/organization${returnTo}`);
      return;
    }

    const teamsWithProjectsOnAnyOrg = organizations.data.flatMap((org) =>
      org.teams.filter((team) => team.projects.length > 0)
    );
    const hasTeamsWithProjectsOnCurrentOrg = organization.teams.some(
      (team) => team.projects.length > 0
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
      void router.push(`/${project.slug}`);
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
      hasTeamPermission: () => false,
      hasOrganizationPermission: () => false,
    };
  }

  const organizationRole = organization?.members[0]?.role;

  const hasOrganizationPermission = (
    roleGroup: keyof typeof OrganizationRoleGroup
  ) => {
    return (
      organizationRole &&
      (
        organizationRolePermissionMapping[roleGroup] as OrganizationUserRole[]
      ).includes(organizationRole)
    );
  };

  const hasTeamPermission = (
    roleGroup: keyof typeof TeamRoleGroup,
    team_ = team
  ) => {
    const teamRole = team_?.members[0]?.role;
    return (
      teamRole &&
      (teamRolePermissionMapping[roleGroup] as TeamUserRole[]).includes(
        teamRole
      )
    );
  };

  return {
    isLoading: false,
    isRefetching: organizations.isRefetching,
    organizations: organizations.data,
    organization,
    team,
    project,
    hasOrganizationPermission,
    hasTeamPermission,
  };
};
