import type { MigrationTenantStatus, OrganizationRole } from "@langwatch/authz-contract";
import type {
  AuthzAssignableRoleRow,
  AuthzBindingScopeRow,
  AuthzManagedBindingRow,
  AuthzUserGroupRow,
} from "../authz-binding.repository.ts";

export type AuthzMemoryCutoverRow = {
  organizationId: string;
  status: MigrationTenantStatus;
  occurredAt: Date | null;
};

/**
 * The one in-process table every authz memory repository reads and writes.
 * Sharing it makes the memory tier behave like a database, not a set of
 * unrelated doubles: a cutover written through one repository is read by the next.
 */
export class AuthzMemoryStore {
  readonly epochs = new Map<string, number>();
  readonly cutovers = new Map<string, AuthzMemoryCutoverRow>();
  readonly bindings: AuthzManagedBindingRow[] = [];
  readonly scopes: (AuthzBindingScopeRow & { organizationId: string })[] = [];
  readonly groupMemberships: ({ organizationId: string; userId: string } & AuthzUserGroupRow)[] =
    [];
  readonly organizationRoles = new Map<string, OrganizationRole>();
  readonly legacySharedTeamMemberships: { organizationId: string; userId: string }[] = [];
  readonly roles: (AuthzAssignableRoleRow & { organizationId: string })[] = [];
  readonly apiKeys: { organizationId: string; apiKeyId: string }[] = [];

  static create(): AuthzMemoryStore {
    return new AuthzMemoryStore();
  }

  private constructor() {}

  reset(): void {
    this.epochs.clear();
    this.cutovers.clear();
    this.organizationRoles.clear();
    for (const rows of [
      this.bindings,
      this.scopes,
      this.groupMemberships,
      this.legacySharedTeamMemberships,
      this.roles,
      this.apiKeys,
    ]) {
      rows.length = 0;
    }
  }
}
