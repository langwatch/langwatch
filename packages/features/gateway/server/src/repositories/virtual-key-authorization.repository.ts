/**
 * The organization directory a virtual-key authorization decision reads:
 * team/project membership, and whether a row is in the organization at all.
 * Every lookup is org-scoped; absence from the result IS the refusal.
 */
export abstract class VirtualKeyAuthorizationRepository {
  /** The team a project hangs off, or null for a dangling reference. */
  abstract tryFindProjectTeam(input: {
    projectId: string;
  }): Promise<{ id: string; teamId: string } | null>;
  /**
   * The role a person holds in an organization, or null. A membership an
   * admin disabled to reclaim its seat reads as no membership.
   */
  abstract tryFindOrganizationRole(input: {
    userId: string;
    organizationId: string;
  }): Promise<{ role: string } | null>;
  abstract findMemberTeamIds(input: { userId: string; organizationId: string }): Promise<string[]>;
  abstract findProjectIdsForTeams(input: { teamIds: string[] }): Promise<string[]>;
  /** Of the named teams, those inside this organization. */
  abstract findTeamIdsInOrganization(input: {
    organizationId: string;
    teamIds: string[];
  }): Promise<string[]>;
  /** Of the named projects, those inside this organization. */
  abstract findProjectIdsInOrganization(input: {
    organizationId: string;
    projectIds: string[];
  }): Promise<string[]>;
  abstract tryFindVirtualKeyScopes(input: {
    virtualKeyId: string;
    organizationId: string;
  }): Promise<{
    traceProjectId: string | null;
    scopes: Array<{ scopeType: string; scopeId: string }>;
  } | null>;
  /** Of the named guardrails, those belonging to this project. */
  abstract findGuardrailIdsInProject(input: {
    projectId: string;
    guardrailIds: string[];
  }): Promise<string[]>;
}
