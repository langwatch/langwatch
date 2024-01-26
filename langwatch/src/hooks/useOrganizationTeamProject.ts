import { useRouter } from "next/router";
import { useEffect } from "react";
import { useLocalStorage } from "usehooks-ts";
import { api } from "../utils/api";
import { useRequiredSession } from "./useRequiredSession";
import {
  organizationRolePermissionMapping,
  type OrganizationRoleGroup,
  type TeamRoleGroup,
  teamRolePermissionMapping,
} from "../server/api/permission";
import type { OrganizationUserRole, TeamUserRole } from "@prisma/client";

export const useOrganizationTeamProject = (
  {
    redirectToProjectOnboarding,
    keepFetching,
  }: { redirectToProjectOnboarding?: boolean; keepFetching?: boolean } = {
    redirectToProjectOnboarding: true,
    keepFetching: false,
  }
) => {
  useRequiredSession();

  const organizations = api.organization.getAll.useQuery(undefined, {
    staleTime: keepFetching ? undefined : Infinity,
    refetchInterval: keepFetching ? 5_000 : undefined,
  });
  const [organizationId, setOrganizationId] = useLocalStorage<string>(
    "selectedOrganizationId",
    ""
  );
  const [teamId, setTeamId] = useLocalStorage<string>("selectedTeamId", "");
  const [localStorageProjectSlug, setProjectSlug] = useLocalStorage<string>(
    "selectedProjectSlug",
    ""
  );
  const router = useRouter();

  const projectSlug =
    typeof router.query.project == "string"
      ? router.query.project
      : localStorageProjectSlug;

  const projectsMatchingSlug = organizations.data?.flatMap((org) =>
    org.teams.flatMap((team) =>
      team.projects.filter((project) => project.slug == projectSlug)
    )
  );

  const organization = organizations.data
    ? organizations.data.find((org) => org.id == organizationId) ??
      organizations.data[0]
    : undefined;
  const team = organization
    ? organization.teams.find((team) => team.id == teamId) ??
      organization.teams.find((team) => team.projects.length > 0) ??
      organization.teams[0]
    : undefined;
  const project = team
    ? projectSlug
      ? team.projects.find((project) => project.slug == projectSlug) ??
        projectsMatchingSlug?.[0]
      : team.projects[0]
    : undefined;

  useEffect(() => {
    if (organization && organization.id !== organizationId) {
      setOrganizationId(organization.id);
    }
    if (team && team.id !== teamId) {
      setTeamId(team.id);
    }
    if (project && project.slug !== localStorageProjectSlug) {
      setProjectSlug(project.slug);
    }
  }, [
    localStorageProjectSlug,
    organization,
    organizationId,
    project,
    projectSlug,
    setOrganizationId,
    setProjectSlug,
    setTeamId,
    team,
    teamId,
  ]);

  useEffect(() => {
    if (!organizations.data) return;

    if (!organization) {
      void router.push("/onboarding/organization");
      return;
    }

    if (
      redirectToProjectOnboarding &&
      !organization.teams.some((team) => team.projects.length > 0)
    ) {
      const firstTeamSlug = organizations.data.flatMap((org) => org.teams)[0]
        ?.slug;
      void router.push(`/onboarding/${firstTeamSlug}/project`);
      return;
    }
  }, [
    organization,
    organizations.data,
    project,
    redirectToProjectOnboarding,
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
