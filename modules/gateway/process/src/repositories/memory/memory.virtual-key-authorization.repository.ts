import { VirtualKeyAuthorizationRepository } from "../virtual-key-authorization.repository.ts";
import type { MemoryGatewayStore } from "./memory.gateway.store.ts";

/** What a key write is authorized against: seeded teams and projects, owned keys and guardrails. */
export class MemoryVirtualKeyAuthorizationRepository extends VirtualKeyAuthorizationRepository {
  static create(store: MemoryGatewayStore): MemoryVirtualKeyAuthorizationRepository {
    return new MemoryVirtualKeyAuthorizationRepository(store);
  }

  private constructor(private readonly store: MemoryGatewayStore) {
    super();
  }

  async findProjectIdsForTeams(input: { teamIds: string[] }): Promise<string[]> {
    const teamIds = new Set(input.teamIds);
    return this.store.projects
      .filter((project) => teamIds.has(project.teamId))
      .map((project) => project.id);
  }

  async findTeamIdsInOrganization(input: {
    organizationId: string;
    teamIds: string[];
  }): Promise<string[]> {
    const teamIds = new Set(input.teamIds);
    return this.store.teams
      .filter((team) => team.organizationId === input.organizationId && teamIds.has(team.id))
      .map((team) => team.id);
  }

  async findVirtualKeyScopes(input: { virtualKeyId: string; organizationId: string }): Promise<{
    traceProjectId: string | null;
    scopes: { scopeType: string; scopeId: string }[];
  } | null> {
    const key = this.store.virtualKeys.get(input.virtualKeyId);
    if (key?.organizationId !== input.organizationId) return null;

    return {
      traceProjectId: key.traceProjectId,
      scopes: key.scopes.map(({ scopeType, scopeId }) => ({ scopeType, scopeId })),
    };
  }

  async findGuardrailIdsInProject(input: {
    projectId: string;
    guardrailIds: string[];
  }): Promise<string[]> {
    const ids = new Set(input.guardrailIds);
    return [...this.store.guardrails.values()]
      .filter((guardrail) => guardrail.projectId === input.projectId && ids.has(guardrail.id))
      .map((guardrail) => guardrail.id);
  }
}
