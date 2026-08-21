import { useLocalStorage } from "usehooks-ts";
import type { OrganizationUserRole } from "~/generated/prisma/client";
import {
  organizationRoleOf,
  selectAmbientTeam,
  useOrganizationTeamProject,
  userCanOpenTeam,
} from "~/hooks/useOrganizationTeamProject";
import { useRequiredSession } from "~/hooks/useRequiredSession";

interface CandidateTeam {
  isPersonal?: boolean | null;
  members?: { userId: string }[];
  projects: { slug: string }[];
}

/**
 * Which project the LLM Ops product opens, from anywhere in the app.
 *
 * On an LLM Ops page that is the project being shown. Everywhere else the
 * ambient project can be private (the Me pages resolve the personal
 * workspace) or absent, and LLM Ops still has somewhere to go: the project
 * the reader last had open, else the first one of a team they are allowed to
 * open. Null only when no team they can open holds a project, which is the
 * one case where the product has no home and the switcher greys it out.
 *
 * Spec: specs/navigation/product-switcher-navigation.feature
 */
export function resolveLlmOpsProjectSlug({
  ambientProject,
  rememberedProjectSlug,
  teams,
  userId,
  organizationRole,
}: {
  ambientProject: { slug: string; isPersonal?: boolean | null } | undefined;
  rememberedProjectSlug: string;
  teams: CandidateTeam[];
  userId: string | undefined;
  organizationRole: OrganizationUserRole | undefined;
}): string | null {
  if (ambientProject && !ambientProject.isPersonal) return ambientProject.slug;

  const openableTeams = teams.filter(
    (team) =>
      !team.isPersonal &&
      userCanOpenTeam({ team, userId, organizationRole }) &&
      team.projects.length > 0,
  );

  const remembered = openableTeams
    .flatMap((team) => team.projects)
    .find((project) => project.slug === rememberedProjectSlug);
  if (remembered) return remembered.slug;

  // The same preference the ambient context resolves with, so the product
  // opens where an organization-scoped page would have put the reader.
  const preferredTeam = selectAmbientTeam({ teams: openableTeams, userId });
  return preferredTeam?.projects[0]?.slug ?? null;
}

/** `resolveLlmOpsProjectSlug` against the live workspace and this device. */
export function useLlmOpsProjectSlug(): string | null {
  const { organization, project } = useOrganizationTeamProject({
    redirectToOnboarding: false,
    redirectToProjectOnboarding: false,
  });
  const { data: session } = useRequiredSession();
  const [rememberedProjectSlug] = useLocalStorage<string>(
    "selectedProjectSlug",
    "",
  );

  return resolveLlmOpsProjectSlug({
    ambientProject: project,
    rememberedProjectSlug,
    teams: organization?.teams ?? [],
    userId: session?.user?.id,
    organizationRole: organizationRoleOf(organization),
  });
}
