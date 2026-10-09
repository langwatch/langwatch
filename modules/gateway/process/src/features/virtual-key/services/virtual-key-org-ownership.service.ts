/** Whether what a key names (scopes, trace destination, guardrail project) is its own org's. */
import {
  GatewayGuardrailProjectMismatchError,
  GatewayScopeOrgMismatchError,
} from "@langwatch/gateway-contract";
import type { ProjectApi } from "@langwatch/project-contract";

import type { VirtualKeyAuthorizationRepository } from "../../../repositories/virtual-key-authorization.repository.ts";

/** A key's scopes as given (or read from the stored key when absent) and its trace destination. */
export type GuardrailProjectKey = {
  organizationId: string;
  vkId: string | null;
  inputScopes: { scopeType: string; scopeId: string }[] | undefined;
  traceProjectId?: string | null;
};

/**
 * Every id must come back from an org-scoped lookup: an id naming another tenant's row simply does
 * not match the where clause, so absence from the result is the refusal and the query never has to
 * compare tenants itself.
 */
async function assertAllResolve(
  scopeType: string,
  ids: string[],
  lookup: (ids: string[]) => Promise<string[]>,
): Promise<void> {
  if (ids.length === 0) {
    return;
  }

  const found = new Set(await lookup(ids));
  if (ids.some((id) => !found.has(id))) {
    throw new GatewayScopeOrgMismatchError(scopeType);
  }
}

export class VirtualKeyOrgOwnershipService {
  static create(input: {
    directory: VirtualKeyAuthorizationRepository;
    projects: Pick<ProjectApi, "listIdsByOrganization">;
  }): VirtualKeyOrgOwnershipService {
    return new VirtualKeyOrgOwnershipService(input.directory, input.projects);
  }

  private constructor(
    private readonly directory: VirtualKeyAuthorizationRepository,
    private readonly projects: Pick<ProjectApi, "listIdsByOrganization">,
  ) {}

  /** Of the named projects, those inside this organization. */
  private async projectIdsInOrganization(input: {
    organizationId: string;
    projectIds: string[];
  }): Promise<string[]> {
    const inOrganization = new Set(
      await this.projects.listIdsByOrganization({ organizationId: input.organizationId }),
    );

    return input.projectIds.filter((id) => inOrganization.has(id));
  }

  /**
   * Every requested scope must belong to the key's own organization. Proving the caller controls
   * each scope is not the same as proving it lives in this organization: without this, a caller
   * with rights in one org could submit another's id plus a scope from theirs.
   */
  async assertScopesBelongToOrg({
    organizationId,
    scopes,
  }: {
    organizationId: string;
    scopes: { scopeType: string; scopeId: string }[];
  }): Promise<void> {
    const idsOfType = (scopeType: string) =>
      scopes.filter((s) => s.scopeType === scopeType).map((s) => s.scopeId);

    if (scopes.some((s) => s.scopeType === "ORGANIZATION" && s.scopeId !== organizationId)) {
      throw new GatewayScopeOrgMismatchError("organization");
    }

    await assertAllResolve("team", idsOfType("TEAM"), (teamIds) =>
      this.directory.findTeamIdsInOrganization({ organizationId, teamIds }),
    );

    await assertAllResolve("project", idsOfType("PROJECT"), (projectIds) =>
      this.projectIdsInOrganization({ organizationId, projectIds }),
    );
  }

  /**
   * The one project a key's guardrails are judged against: its single project scope, else its
   * trace destination. With neither there is no guardrail surface, so it throws
   * GatewayGuardrailProjectMismatchError.
   */
  async getGuardrailProjectId({
    organizationId,
    vkId,
    inputScopes,
    traceProjectId,
  }: GuardrailProjectKey): Promise<string> {
    let scopes = inputScopes;
    let storedTraceProjectId: string | null = null;
    if (!scopes && vkId) {
      const vk = await this.directory.findVirtualKeyScopes({
        virtualKeyId: vkId,
        organizationId,
      });
      scopes = vk?.scopes;
      storedTraceProjectId = vk?.traceProjectId ?? null;
    }

    const projectScopes = (scopes ?? []).filter((s) => s.scopeType === "PROJECT");
    if (projectScopes.length === 1) {
      return projectScopes[0]!.scopeId;
    }

    // Guardrails are project-scoped and enforce where traces land, so an
    // org- or team-owned key's guardrail surface is its explicit trace
    // destination.
    const destination = traceProjectId ?? storedTraceProjectId;
    if (!destination) {
      throw new GatewayGuardrailProjectMismatchError();
    }

    return destination;
  }

  /**
   * The explicit trace destination must be a project of the key's own
   * organization: it decides where traces (and therefore budget debits)
   * land, and a stray id would route another tenant's costs.
   */
  async assertTraceProjectBelongsToOrg({
    organizationId,
    traceProjectId,
  }: {
    organizationId: string;
    traceProjectId: string | null | undefined;
  }): Promise<void> {
    if (!traceProjectId) {
      return;
    }

    const found = await this.projectIdsInOrganization({
      organizationId,
      projectIds: [traceProjectId],
    });
    if (found.length === 0) {
      throw new GatewayScopeOrgMismatchError("project");
    }
  }
}
