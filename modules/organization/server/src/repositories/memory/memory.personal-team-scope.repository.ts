import { RoleBindingScopeType } from "@langwatch/organization-contract";
import type { PersonalTeamScopeReader } from "../../services/personal-team-scope.service.ts";
import type { MemoryOrganizationDatabase } from "./memory.organization.database.ts";

/** In-memory {@link PersonalTeamScopeReader}, for tests and a memory-backed boot. */
export class MemoryPersonalTeamScopeRepository implements PersonalTeamScopeReader {
  private constructor(private readonly memory: MemoryOrganizationDatabase) {}

  static create(options: { memory: MemoryOrganizationDatabase }): MemoryPersonalTeamScopeRepository {
    return new MemoryPersonalTeamScopeRepository(options.memory);
  }

  async tryFindPersonalTeamInScopes(input: {
    scopes: Array<{ scopeType: RoleBindingScopeType; scopeId: string }>;
  }): Promise<{ name: string } | null> {
    return this.findMatching(input.scopes, () => true);
  }

  async tryFindForeignPersonalTeamInScopes(input: {
    scopes: Array<{ scopeType: RoleBindingScopeType; scopeId: string }>;
    ownerUserId: string | null;
  }): Promise<{ name: string } | null> {
    return this.findMatching(
      input.scopes,
      (ownerUserId) => input.ownerUserId === null || ownerUserId !== input.ownerUserId,
    );
  }

  private findMatching(
    scopes: Array<{ scopeType: RoleBindingScopeType; scopeId: string }>,
    matchesOwner: (ownerUserId: string | null) => boolean,
  ): { name: string } | null {
    for (const scope of scopes) {
      if (scope.scopeType === RoleBindingScopeType.TEAM) {
        const team = this.memory.teams.get(scope.scopeId);
        if (team?.isPersonal && matchesOwner(team.ownerUserId)) return { name: team.name };
      }
      if (scope.scopeType === RoleBindingScopeType.PROJECT) {
        const project = this.memory.projects.get(scope.scopeId);
        const team = project ? this.memory.teams.get(project.teamId) : undefined;
        if (project?.isPersonal && team && matchesOwner(team.ownerUserId)) {
          return { name: team.name };
        }
      }
    }
    return null;
  }
}
