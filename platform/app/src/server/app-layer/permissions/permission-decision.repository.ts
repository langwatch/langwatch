/** Adapts the grants engine to the permission service contract. */
import type { AuthzDenialReason, AuthzPermission } from "@langwatch/authz";
import type { AuthzService } from "@langwatch/authz-server";
import type { OrganizationUserRole } from "~/generated/prisma/client";
import { isDemoProject } from "~/server/app-layer/authz/permission-adapters";

export type PermissionDecision = {
  permitted: boolean;
  organizationRole: OrganizationUserRole | null;
  /**
   * Why the check failed, when it did — the boundary needs it to pick the
   * error a caller can act on. Absent on a permitted decision, and on the
   * checks with no resolved scope.
   */
  denialReason?: AuthzDenialReason;
};

export interface PermissionDecisionRepository {
  findProjectDecision(params: {
    userId: string;
    projectId: string;
    permission: AuthzPermission;
  }): Promise<PermissionDecision>;
  findProjectAnyDecision(params: {
    userId: string;
    projectId: string;
    permissions: readonly AuthzPermission[];
  }): Promise<PermissionDecision>;
  findTeamDecision(params: {
    userId: string;
    teamId: string;
    permission: AuthzPermission;
  }): Promise<PermissionDecision>;
  findOrganizationDecision(params: {
    userId: string;
    organizationId: string;
    permission: AuthzPermission;
  }): Promise<PermissionDecision>;
}

export class EnginePermissionDecisionRepository
  implements PermissionDecisionRepository
{
  readonly #authz: AuthzService;

  private constructor(authz: AuthzService) {
    this.#authz = authz;
  }

  static create(authz: AuthzService): EnginePermissionDecisionRepository {
    return new EnginePermissionDecisionRepository(authz);
  }

  async findProjectDecision(input: {
    userId: string;
    projectId: string;
    permission: AuthzPermission;
  }): Promise<PermissionDecision> {
    if (isDemoProject(input.projectId, input.permission)) {
      return { permitted: true, organizationRole: null };
    }
    return this.#check(input);
  }

  async findProjectAnyDecision({
    userId,
    projectId,
    permissions,
  }: {
    userId: string;
    projectId: string;
    permissions: readonly AuthzPermission[];
  }): Promise<PermissionDecision> {
    if (
      permissions.some((permission) => isDemoProject(projectId, permission))
    ) {
      return { permitted: true, organizationRole: null };
    }
    const decision = await this.#authz.canAnyByIds({
      principal: { type: "user", id: userId },
      projectId,
      permissions,
    });
    return {
      permitted: decision.allowed,
      organizationRole: decision.organizationRole,
      denialReason: decision.denialReason,
    };
  }

  findTeamDecision(input: {
    userId: string;
    teamId: string;
    permission: AuthzPermission;
  }): Promise<PermissionDecision> {
    return this.#check(input);
  }

  async findOrganizationDecision(input: {
    userId: string;
    organizationId: string;
    permission: AuthzPermission;
  }): Promise<PermissionDecision> {
    const decision = await this.#check(input);
    return { ...decision, organizationRole: null };
  }

  async #check({
    userId,
    ...scope
  }: {
    userId: string;
    permission: AuthzPermission;
    projectId?: string;
    teamId?: string;
    organizationId?: string;
  }): Promise<PermissionDecision> {
    const decision = await this.#authz.checkByIds({
      principal: { type: "user", id: userId },
      ...scope,
    });
    return {
      permitted: decision.allowed,
      organizationRole: decision.organizationRole,
      denialReason: decision.denialReason,
    };
  }
}
