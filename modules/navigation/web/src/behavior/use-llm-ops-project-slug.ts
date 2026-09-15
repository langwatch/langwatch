import { useNavigationHost, type NavigationTeam } from "../model/navigation-host.ts";

/** Which project LLM Ops opens; moved from platform/app, team access now delegated to host */
export function resolveLlmOpsProjectSlug({
  ambientProject,
  rememberedProjectSlug,
  openableTeams,
}: {
  ambientProject: { slug: string; isPersonal?: boolean | null } | undefined;
  rememberedProjectSlug: string;
  /** Teams the reader may open, in the host's ambient preference order. */
  openableTeams: readonly NavigationTeam[];
}): string | null {
  if (ambientProject && !ambientProject.isPersonal) return ambientProject.slug;

  const candidates = openableTeams.filter((team) => !team.isPersonal && team.projects.length > 0);

  const remembered = candidates
    .flatMap((team) => team.projects)
    .find((project) => project.slug === rememberedProjectSlug);
  if (remembered) return remembered.slug;

  return candidates[0]?.projects[0]?.slug ?? null;
}

/** `resolveLlmOpsProjectSlug` against the live workspace and this device. */
export function useLlmOpsProjectSlug(): string | null {
  const host = useNavigationHost();

  return resolveLlmOpsProjectSlug({
    ambientProject: host.project(),
    rememberedProjectSlug: host.rememberedProjectSlug(),
    openableTeams: host.openableTeams(),
  });
}
