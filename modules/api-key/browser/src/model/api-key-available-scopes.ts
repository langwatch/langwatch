/**
 * The scopes the API key pickers offer, read off the organization graph. A
 * personal workspace's project carries its owner as a hint, so two "Personal
 * Workspace" rows read apart. Spec: specs/components/scope-picker-same-name-projects.feature
 */

import { personalWorkspaceHint } from "@langwatch/design-system/scope-filter";
import { personalTeamOwnerName } from "@langwatch/organization-contract";

import type { ApiKeyAvailableScopes } from "./api-key-host.ts";

type ScopeTeam = {
  id: string;
  name: string;
  isPersonal?: boolean | null;
  ownerUserId?: string | null;
  projects: { id: string; name: string }[];
};

/** "Sam Lee", or "Alex Rivera (you)" for the reader's own; nothing for a shared team. */
function ownerHintOf({
  team,
  viewerUserId,
}: {
  team: ScopeTeam;
  viewerUserId: string | undefined;
}): string | undefined {
  if (!team.isPersonal) return void 0;
  return personalWorkspaceHint({
    ownerName: personalTeamOwnerName({ teamName: team.name }),
    isViewer: !!viewerUserId && team.ownerUserId === viewerUserId,
  });
}

export function availableScopesOf({
  organization,
  viewerUserId,
}: {
  organization: { id: string; name: string; teams: ScopeTeam[] } | undefined;
  viewerUserId: string | undefined;
}): ApiKeyAvailableScopes {
  const teams = organization?.teams ?? [];
  return {
    organization: organization ? { id: organization.id, name: organization.name } : null,
    teams: teams.map((team) => ({ id: team.id, name: team.name })),
    projects: teams.flatMap((team) => {
      const hint = ownerHintOf({ team, viewerUserId });
      return team.projects.map((project) => ({
        id: project.id,
        name: project.name,
        teamId: team.id,
        ...(hint ? { hint } : {}),
      }));
    }),
  };
}

/** The drawers' project list, carrying the owner hints of the scopes the reader can see. */
export function withOwnerHints<P extends { id: string }>({
  projects,
  scopes,
}: {
  projects: P[];
  scopes: ApiKeyAvailableScopes;
}): (P & { hint?: string })[] {
  const hintById = new Map(scopes.projects.map((project) => [project.id, project.hint] as const));
  return projects.map((project) => {
    const hint = hintById.get(project.id);
    return hint ? { ...project, hint } : project;
  });
}
