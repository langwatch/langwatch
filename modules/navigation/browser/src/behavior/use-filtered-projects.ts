import { useMemo } from "react";

import { MIN_CATEGORY_MATCH_LENGTH } from "../model/command-bar-constants.ts";

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
  teams: {
    name: string;
    members?: TeamMember[];
    projects: {
      slug: string;
      name: string;
    }[];
  }[];
}

function isMemberOf({
  team,
  currentUserId,
}: {
  team: Organization["teams"][number];
  currentUserId: string | undefined;
}): boolean {
  if (!currentUserId) return false;
  return team.members?.some((m) => m.userId === currentUserId) ?? false;
}

function projectsMatching({
  organizations,
  lowerQuery,
  isSearchingCategory,
  currentProjectSlug,
  currentUserId,
}: {
  organizations: Organization[];
  lowerQuery: string;
  isSearchingCategory: boolean;
  currentProjectSlug: string | undefined;
  currentUserId: string | undefined;
}): FilteredProject[] {
  return organizations.flatMap((org) =>
    org.teams
      .filter((team) => isMemberOf({ team, currentUserId }))
      .flatMap((team) => {
        const orgTeam = team.name !== org.name ? `${org.name} / ${team.name}` : org.name;
        const teamMatches =
          org.name.toLowerCase().includes(lowerQuery) ||
          team.name.toLowerCase().includes(lowerQuery);
        return team.projects
          .filter((proj) => proj.slug !== currentProjectSlug)
          .filter(
            (proj) =>
              isSearchingCategory || teamMatches || proj.name.toLowerCase().includes(lowerQuery),
          )
          .map((proj) => ({ slug: proj.slug, name: proj.name, orgTeam }));
      }),
  );
}

/**
 * Hook for filtering projects based on search query.
 * Filters by project name, organization name, or team name.
 * Only includes projects from teams where the current user is a member.
 */
export function useFilteredProjects({
  query,
  organizations,
  currentProjectSlug,
  currentUserId,
}: {
  query: string;
  organizations: Organization[] | undefined;
  currentProjectSlug: string | undefined;
  currentUserId: string | undefined;
}): FilteredProject[] {
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
      (kw) => kw.startsWith(lowerQuery) && lowerQuery.length >= MIN_CATEGORY_MATCH_LENGTH,
    );

    return projectsMatching({
      organizations,
      lowerQuery,
      isSearchingCategory,
      currentProjectSlug,
      currentUserId,
    });
  }, [organizations, currentProjectSlug, currentUserId, query]);
}
