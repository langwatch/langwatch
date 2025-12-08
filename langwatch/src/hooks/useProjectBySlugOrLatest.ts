import { useRouter } from "next/router";
import { useMemo } from "react";

export interface MinimalProject {
  id: string;
  slug: string;
  name: string;
  apiKey?: string;
  createdAt?: Date | string | null;
}

export interface MinimalTeam {
  id: string;
  projects?: MinimalProject[];
}

export interface MinimalOrganization {
  id: string;
  teams?: MinimalTeam[];
}

/**
 * Get a project by slug (from router query `projectSlug`) or fallback to the
 * latest-created project across all teams in the provided organization.
 */
export function useProjectBySlugOrLatest(organization?: MinimalOrganization) {
  const router = useRouter();

  const project = useMemo(() => {
    if (!organization) return undefined;

    const allProjects: MinimalProject[] = (organization.teams ?? [])
      .flatMap((team) => team?.projects ?? [])
      .filter(Boolean);

    if (!allProjects.length) return undefined;

    const query = router.query.projectSlug;
    const slug = Array.isArray(query) ? query[0] : query;

    const normalizeDate = (value?: Date | string | null): number => {
      if (!value) return 0;
      if (value instanceof Date) return value.getTime();
      const time = new Date(value).getTime();
      return Number.isNaN(time) ? 0 : time;
    };

    if (slug) {
      const matching = allProjects
        .filter((p) => p.slug === slug)
        .sort(
          (a, b) => normalizeDate(b.createdAt) - normalizeDate(a.createdAt),
        );
      if (matching[0]) return matching[0];
    }

    return allProjects.sort(
      (a, b) => normalizeDate(b.createdAt) - normalizeDate(a.createdAt),
    )[0];
  }, [organization, router.query.projectSlug]);

  return { project };
}
