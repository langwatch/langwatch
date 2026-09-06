import type { LedgerActor } from "@langwatch/actor";
import { type Role, type RoleCreate, type RoleUpdate } from "@langwatch/role-contract";

export type RoleRow = Role;

export abstract class RoleRepository {
  abstract findAll(organizationId: string): Promise<Role[]>;
  abstract tryFindById(roleId: string): Promise<Role | null>;
  abstract tryFindCustomByIdInOrganization(input: {
    roleId: string;
    organizationId: string;
  }): Promise<Role | null>;
  abstract tryFindTeam(teamId: string): Promise<{ organizationId: string } | null>;
  abstract hasTeamMember(input: {
    userId: string;
    organizationId: string;
    teamId: string;
  }): Promise<boolean>;
  abstract tryFindUserBinding(input: {
    userId: string;
    organizationId: string;
    teamId: string;
  }): Promise<{ customRoleId: string } | null>;
  abstract findAssignable(
    roleIds: string[],
    organizationId: string,
  ): Promise<Array<{ id: string }>>;
  abstract findAssignablePermissions(
    roleIds: string[],
    organizationId: string,
  ): Promise<Array<{ id: string; permissions: string[] }>>;
  abstract countRoleBindings(input: { roleId: string; organizationId: string }): Promise<number>;
  abstract countAssignedUsers(roleId: string): Promise<number>;
  abstract create(input: {
    role: RoleCreate;
    actor: LedgerActor;
    /**
     * Whether a definition that did not become readable inside the
     * read-your-writes window is an error. The API-key mint turns it on: it
     * binds a grant to this role and then activates the credential, so an
     * unconfirmed definition would hand out a key whose permissions nothing
     * can resolve.
     */
    requireProjection?: boolean;
  }): Promise<Role>;
  abstract update(input: {
    roleId: string;
    changes: RoleUpdate;
    actor: LedgerActor;
  }): Promise<Role>;
  abstract deleteIfUnused(input: {
    roleId: string;
    organizationId: string;
    actor: LedgerActor;
    awaitProjection?: boolean;
  }): Promise<boolean>;
  abstract assign(input: {
    userId: string;
    teamId: string;
    customRoleId: string;
    actor: LedgerActor;
  }): Promise<void>;
  abstract remove(input: { userId: string; teamId: string; actor: LedgerActor }): Promise<void>;
  abstract isExclusiveToApiKey(input: { roleId: string; apiKeyId: string }): Promise<boolean>;
  abstract removeExclusiveApiKeyRoles(input: {
    roleIds: string[];
    apiKeyId: string;
    organizationId: string;
    actor: LedgerActor;
    awaitProjection?: boolean;
  }): Promise<void>;
}
