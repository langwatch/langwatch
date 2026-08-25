import type { LedgerActor } from "@langwatch/actor";
import type { Role, RoleCreate, RoleBindingScopeType, RoleUpdate } from "./role";

export abstract class RoleService {
  abstract list(input: { organizationId: string }): Promise<Role[]>;
  abstract get(input: { roleId: string }): Promise<Role>;
  abstract getForOrganization(input: {
    roleId: string;
    organizationId: string;
  }): Promise<Role>;
  abstract tryGet(input: { roleId: string }): Promise<Role | null>;
  abstract create(input: { role: RoleCreate; actor: LedgerActor }): Promise<Role>;
  abstract update(input: {
    roleId: string;
    changes: RoleUpdate;
    actor: LedgerActor;
  }): Promise<Role>;
  abstract updateForOrganization(input: {
    roleId: string;
    organizationId: string;
    changes: RoleUpdate;
    actor: LedgerActor;
  }): Promise<Role>;
  abstract remove(input: {
    roleId: string;
    actor: LedgerActor;
  }): Promise<{ success: true }>;
  abstract removeForOrganization(input: {
    roleId: string;
    organizationId: string;
    actor: LedgerActor;
  }): Promise<{ success: true }>;
  abstract assignToUser(input: {
    userId: string;
    teamId: string;
    customRoleId: string;
    actor: LedgerActor;
  }): Promise<{ success: true }>;
  abstract removeFromUser(input: {
    userId: string;
    teamId: string;
    actor: LedgerActor;
  }): Promise<{ success: true }>;
  abstract tryGetUserBinding(input: {
    userId: string;
    organizationId: string;
    teamId: string;
  }): Promise<{ customRoleId: string } | null>;
  abstract validateAssignable(input: {
    roleIds: string[];
    organizationId: string;
  }): Promise<void>;
  abstract filterAssignable(input: {
    roleIds: string[];
    organizationId: string;
  }): Promise<string[]>;
  abstract assertNoOrganizationExclusivePermissionsBelowOrganizationScope(input: {
    organizationId: string;
    customBindings: Array<{ customRoleId: string; scopeType: RoleBindingScopeType }>;
  }): Promise<void>;
  abstract isExclusiveToApiKey(input: {
    roleId: string;
    apiKeyId: string;
  }): Promise<boolean>;
  abstract removeExclusiveApiKeyRoles(input: {
    roleIds: string[];
    apiKeyId: string;
    organizationId: string;
    actor: LedgerActor;
    awaitProjection?: boolean;
  }): Promise<void>;
}
