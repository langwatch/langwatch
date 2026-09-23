import { RoleBindingScopeType } from "@langwatch/organization-contract";

import type { PersonalTeamScopeReader } from "../../services/personal-team-scope.service.ts";
import type { MemoryOrganizationDatabase, MemoryTeamRow } from "./memory.organization.database.ts";

/** In-memory {@link PersonalTeamScopeReader}, for tests and a memory-backed boot. */
export class MemoryPersonalTeamScopeRepository implements PersonalTeamScopeReader {
  private constructor(private readonly memory: MemoryOrganizationDatabase) {}

  static create(options: {
    memory: MemoryOrganizationDatabase;
  }): MemoryPersonalTeamScopeRepository {
    return new MemoryPersonalTeamScopeRepository(options.memory);
  }

  async tryFindPersonalTeamInScopes(input: {
    scopes: { scopeType: RoleBindingScopeType; scopeId: string }[];
  }): Promise<{ name: string } | null> {
    return this.findMatching(input.scopes, () => true);
  }

  async tryFindForeignPersonalTeamInScopes(input: {
    scopes: { scopeType: RoleBindingScopeType; scopeId: string }[];
    ownerUserId: string | null;
  }): Promise<{ name: string } | null> {
    return this.findMatching(
      input.scopes,
      (ownerUserId) => input.ownerUserId === null || ownerUserId !== input.ownerUserId,
    );
  }

  private findMatching(
    scopes: { scopeType: RoleBindingScopeType; scopeId: string }[],
    matchesOwner: (ownerUserId: string | null) => boolean,
  ): { name: string } | null {
    for (const scope of scopes) {
      const match = personalTeamsReachedBy({ memory: this.memory, scope }).find((team) =>
        matchesOwner(team.ownerUserId),
      );
      if (match) return { name: match.name };
    }
    return null;
  }
}

function personalTeamsReachedBy({
  memory,
  scope,
}: {
  memory: MemoryOrganizationDatabase;
  scope: { scopeType: RoleBindingScopeType; scopeId: string };
}): MemoryTeamRow[] {
  if (scope.scopeType === RoleBindingScopeType.TEAM) {
    const team = memory.teams.get(scope.scopeId);
    return team?.isPersonal ? [team] : [];
  }
  if (scope.scopeType === RoleBindingScopeType.PROJECT) {
    const project = memory.projects.get(scope.scopeId);
    const team = project?.isPersonal ? memory.teams.get(project.teamId) : undefined;
    return team ? [team] : [];
  }
  return [];
}
