import { useNavigationHost, type NavigationTeam } from "../model/navigation-host";

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
 * MOVED from `platform/app/src/features/navigation/useLlmOpsProjectSlug.ts`.
 * One thing changed and it is a seam, not a rule: "a team they are allowed to
 * open" used to be decided here, by calling that application's
 * `userCanOpenTeam` and `selectAmbientTeam` on the raw organization graph. Who
 * may open a team is the HOST's policy — it is the same test its chrome uses
 * to decide whether to render a page at all — so the port answers it, in the
 * ambient preference order the host already resolves scope with, and this
 * module reads the answer. The preference the function itself applies (a
 * shared team holding a project) is unchanged.
 *
 * Spec: specs/navigation/product-switcher-navigation.feature
 */
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

  const candidates = openableTeams.filter(
    (team) => !team.isPersonal && team.projects.length > 0,
  );

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
