import type { OrganizationRole } from "@langwatch/authorization";
import type { MigrationTenantStatus } from "@langwatch/authz-contract";
import type { Instant } from "@langwatch/time";

import type {
  AuthzAssignableRoleRow,
  AuthzBindingScopeRow,
  AuthzGrantPrincipalRow,
  AuthzManagedBindingRow,
  AuthzUserGroupRow,
} from "../authz-managed-grant.repository.ts";

/** One membership's unfinished admission marker. */
export type AuthzMemoryAdmissionRow = {
  organizationId: string;
  userId: string;
  grantId: string;
  occurredAtMs: number;
  disabled: boolean;
};

/** A user's standing as authz folded it from user's and identity's facts. */
export type AuthzMemoryUserStandingRow = {
  deactivated: boolean;
  erased: boolean;
  changedAtMs: number;
};

/** What the ledger says about the grant an admission marker named. */
export type AuthzMemoryAdmissionGrantRow = {
  organizationId: string;
  userId: string;
  grantId: string;
  revoked: boolean;
};

export type AuthzMemoryGrantRow = {
  organizationId: string;
  principal: AuthzGrantPrincipalRow["principal"];
  roleKey: string | null;
  revoked: boolean;
};

export type AuthzMemoryCutoverRow = {
  organizationId: string;
  status: MigrationTenantStatus;
  occurredAt: Instant | null;
};

/**
 * The one in-process table every authz memory repository reads and writes.
 * Sharing it makes the memory tier behave like a database, not a set of
 * unrelated doubles: a cutover written through one repository is read by the next.
 */
export class AuthzMemoryStore {
  readonly epochs = new Map<string, number>();
  readonly sessionVersions = new Map<string, number>();
  readonly cutovers = new Map<string, AuthzMemoryCutoverRow>();
  readonly userStandings = new Map<string, AuthzMemoryUserStandingRow>();
  readonly admissions: AuthzMemoryAdmissionRow[] = [];
  readonly admissionGrants: AuthzMemoryAdmissionGrantRow[] = [];
  readonly bindings: AuthzManagedBindingRow[] = [];
  readonly scopes: (AuthzBindingScopeRow & { organizationId: string })[] = [];
  readonly groupMemberships: ({ organizationId: string; userId: string } & AuthzUserGroupRow)[] =
    [];
  readonly organizationRoles = new Map<string, OrganizationRole>();
  readonly legacySharedTeamMemberships: { organizationId: string; userId: string }[] = [];
  readonly teamMemberships: { organizationId: string; teamId: string; userId: string }[] = [];
  /** The grant ledger head's rows, as far as a role's holders need them. */
  readonly grants: AuthzMemoryGrantRow[] = [];
  readonly roles: (AuthzAssignableRoleRow & { organizationId: string })[] = [];
  readonly apiKeys: { organizationId: string; apiKeyId: string }[] = [];

  static create(): AuthzMemoryStore {
    return new AuthzMemoryStore();
  }

  private constructor() {}

  /** Deactivated or erased, as the standing table says; no row means active. */
  isInactiveUser(userId: string): boolean {
    const row = this.userStandings.get(userId);
    return row !== undefined && (row.deactivated || row.erased);
  }

  reset(): void {
    this.epochs.clear();
    this.sessionVersions.clear();
    this.cutovers.clear();
    this.userStandings.clear();
    this.organizationRoles.clear();
    for (const rows of [
      this.admissions,
      this.admissionGrants,
      this.bindings,
      this.scopes,
      this.groupMemberships,
      this.legacySharedTeamMemberships,
      this.teamMemberships,
      this.grants,
      this.roles,
      this.apiKeys,
    ]) {
      rows.length = 0;
    }
  }
}
