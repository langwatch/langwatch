import { PersonalWorkspaceNotManagedHereError } from "@langwatch/organization-contract";
import type { RoleBindingScopeType } from "@langwatch/organization-contract";

export interface RoleBindingScope {
  scopeType: RoleBindingScopeType;
  scopeId: string;
}

/** The two personal-workspace reads the refusals below rest on. */
export interface PersonalTeamScopeReader {
  findPersonalTeamsInScopes(input: { scopes: RoleBindingScope[] }): Promise<{ name: string }[]>;

  findForeignPersonalTeamsInScopes(input: {
    scopes: RoleBindingScope[];
    ownerUserId: string | null;
  }): Promise<{ name: string }[]>;
}

/** The personal-workspace invariants every role-binding write is held to. */
export class PersonalTeamScopeService {
  static create(reader: PersonalTeamScopeReader): PersonalTeamScopeService {
    return new PersonalTeamScopeService(reader);
  }

  private constructor(private readonly reader: PersonalTeamScopeReader) {}

  async scopesTouchPersonalTeam({ scopes }: { scopes: RoleBindingScope[] }): Promise<boolean> {
    return (await this.reader.findPersonalTeamsInScopes({ scopes })).length > 0;
  }

  /**
   * Refuse any role-binding write that would change who reaches a personal team. A personal
   * team holds exactly one member, its owner.
   */
  async assertNoPersonalTeamScope({ scopes }: { scopes: RoleBindingScope[] }): Promise<void> {
    const [personalTeam] = await this.reader.findPersonalTeamsInScopes({ scopes });
    if (personalTeam) {
      throw new PersonalWorkspaceNotManagedHereError(personalTeam.name);
    }
  }

  /**
   * Refuse a role-binding write that reaches a personal workspace belonging to anyone but the
   * user the credential acts as.
   */
  async assertPersonalTeamScopesOwnedBy({
    scopes,
    ownerUserId,
  }: {
    scopes: RoleBindingScope[];
    /**
     * The user the credential acts as. `null` owns no personal workspace, so
     * every personal scope is refused.
     */
    ownerUserId: string | null;
  }): Promise<void> {
    const [foreignPersonalTeam] = await this.reader.findForeignPersonalTeamsInScopes({
      scopes,
      ownerUserId,
    });
    if (foreignPersonalTeam) {
      throw new PersonalWorkspaceNotManagedHereError(foreignPersonalTeam.name);
    }
  }
}
