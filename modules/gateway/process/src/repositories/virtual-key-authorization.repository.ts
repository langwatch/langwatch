/**
 * The organization directory a virtual-key authorization decision reads:
 * team/project membership, and whether a row is in the organization at all.
 * Every lookup is org-scoped; absence from the result IS the refusal.
 */
export abstract class VirtualKeyAuthorizationRepository {
  abstract findProjectIdsForTeams(input: { teamIds: string[] }): Promise<string[]>;
  /** Of the named teams, those inside this organization. */
  abstract findTeamIdsInOrganization(input: {
    organizationId: string;
    teamIds: string[];
  }): Promise<string[]>;
  abstract findVirtualKeyScopes(input: { virtualKeyId: string; organizationId: string }): Promise<{
    traceProjectId: string | null;
    scopes: { scopeType: string; scopeId: string }[];
  } | null>;
  /** Of the named guardrails, those belonging to this project. */
  abstract findGuardrailIdsInProject(input: {
    projectId: string;
    guardrailIds: string[];
  }): Promise<string[]>;
}
