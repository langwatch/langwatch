import type { GrantScopeTier } from "@langwatch/authz-contract";
import { PersonalWorkspaceNotManagedHereError } from "@langwatch/organization-contract";

export interface PersonalTeamGrantScope {
  scopeType: GrantScopeTier;
  scopeId: string;
}

/** The two personal-workspace reads the refusals below rest on. */
export interface PersonalTeamScopeReader {
  findPersonalTeamsInScopes(input: {
    scopes: PersonalTeamGrantScope[];
  }): Promise<{ name: string }[]>;

  findForeignPersonalTeamsInScopes(input: {
    scopes: PersonalTeamGrantScope[];
    ownerUserId: string | null;
  }): Promise<{ name: string }[]>;
}

/** The personal-workspace invariants every role-binding write is held to. */
export class PersonalTeamScopeService {
  static create(reader: PersonalTeamScopeReader): PersonalTeamScopeService {
    return new PersonalTeamScopeService(reader);
  }

  private constructor(private readonly reader: PersonalTeamScopeReader) {}

  async scopesTouchPersonalTeam({
    scopes,
  }: {
    scopes: PersonalTeamGrantScope[];
  }): Promise<boolean> {
    return (await this.reader.findPersonalTeamsInScopes({ scopes })).length > 0;
  }

  /**
   * Refuse any role-binding write that would change who reaches a personal team. A personal
   * team holds exactly one member, its owner.
   */
  async assertNoPersonalTeamScope({ scopes }: { scopes: PersonalTeamGrantScope[] }): Promise<void> {
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
    scopes: PersonalTeamGrantScope[];
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
