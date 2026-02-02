import { useMemo } from "react";
import { MIN_CATEGORY_MATCH_LENGTH } from "../constants";

export interface FilteredProject {
  slug: string;
  name: string;
  orgTeam: string;
}

interface TeamMember {
  userId: string;
}

interface Organization {
  name: string;
  teams: Array<{
    name: string;
    members?: TeamMember[];
    projects: Array<{
      slug: string;
      name: string;
    }>;
  }>;
}

/**
 * Hook for filtering projects based on search query.
 * Filters by project name, organization name, or team name.
 * Only includes projects from teams where the current user is a member.
 */
export function useFilteredProjects(
  query: string,
  organizations: Organization[] | undefined,
  currentProjectSlug: string | undefined,
  currentUserId: string | undefined
): FilteredProject[] {
  return useMemo(() => {
    if (!organizations || !query.trim()) return [];

    const lowerQuery = query.toLowerCase().trim();

    // Check if user is searching for the category itself (must be a close match)
    const projectKeywords = [
      "switch project",
      "switch projects",
      "projects",
      "workspace",
      "workspaces",
    ];
    const isSearchingCategory = projectKeywords.some(
      (kw) =>
        kw.startsWith(lowerQuery) && lowerQuery.length >= MIN_CATEGORY_MATCH_LENGTH
    );

    const projects: FilteredProject[] = [];

    for (const org of organizations) {
      for (const team of org.teams) {
        // Skip teams where current user is not a member
        const isTeamMember =
          currentUserId &&
          team.members?.some((m) => m.userId === currentUserId);
        if (!isTeamMember) continue;

        for (const proj of team.projects) {
          if (proj.slug === currentProjectSlug) continue;

          // Show all projects if searching category, or filter by name/org/team
          if (
            isSearchingCategory ||
            proj.name.toLowerCase().includes(lowerQuery) ||
            org.name.toLowerCase().includes(lowerQuery) ||
            team.name.toLowerCase().includes(lowerQuery)
          ) {
            const orgTeam =
              team.name !== org.name ? `${org.name} / ${team.name}` : org.name;
            projects.push({ slug: proj.slug, name: proj.name, orgTeam });
          }
        }
      }
    }

    return projects;
  }, [organizations, currentProjectSlug, currentUserId, query]);
}
