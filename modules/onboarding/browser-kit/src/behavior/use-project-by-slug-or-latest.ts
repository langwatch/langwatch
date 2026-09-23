import { useRouter } from "@langwatch/browser-host/use-router";
import { toEpochMs, type TimeInput } from "@langwatch/time";
import { useMemo } from "react";

export interface MinimalProject {
  id: string;
  slug: string;
  name: string;
  apiKey?: string;
  createdAt?: TimeInput | null;
}

export interface MinimalTeam {
  id: string;
  projects?: readonly MinimalProject[];
}

export interface MinimalOrganization {
  id: string;
  teams?: readonly MinimalTeam[];
}

function normalizeDate(value?: TimeInput | null): number {
  if (!value) return 0;

  const time = toEpochMs(value);
  return Number.isNaN(time) ? 0 : time;
}

function sortByNewestProject(a: MinimalProject, b: MinimalProject): number {
  return normalizeDate(b.createdAt) - normalizeDate(a.createdAt);
}

function latestProject(projects: readonly MinimalProject[]): MinimalProject | undefined {
  return [...projects].toSorted(sortByNewestProject)[0];
}

/**
 * Get a project by slug (from router query `projectSlug`) or fallback to the
 * latest-created project across all teams in the provided organization.
 */
export function useProjectBySlugOrLatest(organization?: MinimalOrganization) {
  const router = useRouter();
  const query = router.query.projectSlug;
  const rawSlug = Array.isArray(query) ? query[0] : query;

  const project = useMemo(() => {
    if (!organization) return undefined;

    const allProjects: MinimalProject[] = (organization.teams ?? [])
      .flatMap((team) => [...(team?.projects ?? [])])
      .filter(Boolean);

    if (!allProjects.length) return undefined;

    if (rawSlug) {
      const matching = latestProject(allProjects.filter((project) => project.slug === rawSlug));
      if (matching) return matching;
    }

    return latestProject(allProjects);
  }, [organization, rawSlug]);

  const slug = project?.slug ?? rawSlug ?? undefined;

  return { project, slug };
}
