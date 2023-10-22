import { useRouter } from "next/router";
import { useEffect } from "react";
import { useLocalStorage } from "usehooks-ts";
import { api } from "../utils/api";

export const useOrganizationTeamProject = (
  { redirectToProjectOnboarding } = { redirectToProjectOnboarding: true }
) => {
  const organizations = api.organization.getAll.useQuery(undefined, {
    staleTime: Infinity,
  });
  const [organizationId, setOrganizationId] = useLocalStorage<string>(
    "selectedOrganizationId",
    ""
  );
  const [teamId, setTeamId] = useLocalStorage<string>("selectedTeamId", "");
  const [localStorageProjectId, setProjectId] = useLocalStorage<string>(
    "selectedProjectId",
    ""
  );
  const router = useRouter();

  const projectId =
    typeof router.query.project == "string"
      ? router.query.project
      : localStorageProjectId;

  const organization = organizations.data
    ? organizations.data.find((org) => org.id == organizationId) ??
      organizations.data[0]
    : undefined;
  const team = organization
    ? organization.teams.find((team) => team.id == teamId) ??
      organization.teams[0]
    : undefined;
  const project = team
    ? team.projects.find((project) => project.id == projectId) ??
      team.projects[0]
    : undefined;

  useEffect(() => {
    if (organization && organization.id !== organizationId) {
      setOrganizationId(organization.id);
    }
    if (team && team.id !== teamId) {
      setTeamId(team.id);
    }
    if (project && project.id !== projectId) {
      setProjectId(project.id);
    }
  }, [
    organization,
    organizationId,
    project,
    projectId,
    setOrganizationId,
    setProjectId,
    setTeamId,
    team,
    teamId,
  ]);

  useEffect(() => {
    if (!organizations.data) return;

    if (!organization || !team) {
      void router.push("/onboarding/organization");
      return;
    }

    if (redirectToProjectOnboarding && !project) {
      const firstTeamSlug = organizations.data.flatMap((org) => org.teams)[0]
        ?.slug;
      void router.push(`/onboarding/${firstTeamSlug}/project`);
      return;
    }
  }, [organization, organizations.data, project, redirectToProjectOnboarding, router, team]);

  if (organizations.isLoading) {
    return { isLoading: true };
  }

  return { isLoading: false, organization, team, project };
};
