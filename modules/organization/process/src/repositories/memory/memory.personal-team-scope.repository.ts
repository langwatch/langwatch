import { GrantScopeTier } from "@langwatch/authz-contract";

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

  /** Every team the organization shares: all but each member's personal workspace. */
  async findSharedTeamIds({ organizationId }: { organizationId: string }): Promise<string[]> {
    return [...this.memory.teams.values()]
      .filter((team) => team.organizationId === organizationId && !team.isPersonal)
      .map((team) => team.id);
  }

  async findPersonalTeamsInScopes(input: {
    scopes: { scopeType: GrantScopeTier; scopeId: string }[];
  }): Promise<{ name: string }[]> {
    return this.findMatching(input.scopes, () => true);
  }

  async findForeignPersonalTeamsInScopes(input: {
    scopes: { scopeType: GrantScopeTier; scopeId: string }[];
    ownerUserId: string | null;
  }): Promise<{ name: string }[]> {
    return this.findMatching(
      input.scopes,
      (ownerUserId) => input.ownerUserId === null || ownerUserId !== input.ownerUserId,
    );
  }

  private findMatching(
    scopes: { scopeType: GrantScopeTier; scopeId: string }[],
    matchesOwner: (ownerUserId: string | null) => boolean,
  ): { name: string }[] {
    return scopes.flatMap((scope) =>
      personalTeamsReachedBy({ memory: this.memory, scope })
        .filter((team) => matchesOwner(team.ownerUserId))
        .map((team) => ({ name: team.name })),
    );
  }
}

function personalTeamsReachedBy({
  memory,
  scope,
}: {
  memory: MemoryOrganizationDatabase;
  scope: { scopeType: GrantScopeTier; scopeId: string };
}): MemoryTeamRow[] {
  if (scope.scopeType === GrantScopeTier.TEAM) {
    const team = memory.teams.get(scope.scopeId);
    return team?.isPersonal ? [team] : [];
  }
  if (scope.scopeType === GrantScopeTier.PROJECT) {
    const project = memory.projects.get(scope.scopeId);
    const team = project?.isPersonal ? memory.teams.get(project.teamId) : undefined;
    return team ? [team] : [];
  }
  return [];
}
