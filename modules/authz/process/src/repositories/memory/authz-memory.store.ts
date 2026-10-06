import type { OrganizationRole } from "@langwatch/authorization";
import type { MigrationTenantStatus } from "@langwatch/authz-contract";
import type { Instant } from "@langwatch/time";

import type { AuthzAuditRow } from "../authz-audit-trail.repository.ts";
import type {
  AuthzAssignableRoleRow,
  AuthzBindingScopeRow,
  AuthzManagedBindingRow,
  AuthzUserGroupRow,
} from "../authz-managed-grant.repository.ts";
import type {
  CompatShareLinkRowShape,
  GrantRowShape,
  RoleRowShape,
} from "../prisma/prisma.authz-grant.mapper.ts";

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

/** A Grant head row: the projected fact, and the revocation mark that ends it. */
export type AuthzMemoryGrantRow = GrantRowShape & {
  revokedAt: Instant | null;
  revokedReason: string | null;
};

/** A Role head row; a deleted role keeps its row, marked. */
export type AuthzMemoryRoleRow = RoleRowShape & { deletedAt: Instant | null };

/** The CustomRole compat head the legacy resolver and the binding reads still read. */
export type AuthzMemoryCustomRoleRow = AuthzAssignableRoleRow & {
  organizationId: string;
  name: string;
  description: string | null;
  kind: string;
};

/** A membership's generation, the column the grant fence compares. */
export type AuthzMemoryMembershipStampRow = { membershipStamp: string; disabled: boolean };

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
  /** The grant ledger's Grant head, as the projection writes it. */
  readonly grants: AuthzMemoryGrantRow[] = [];
  readonly roleHeads: AuthzMemoryRoleRow[] = [];
  /** The CustomRole compat head. */
  readonly roles: AuthzMemoryCustomRoleRow[] = [];
  readonly shareLinks: (CompatShareLinkRowShape & { viewCount: number })[] = [];
  readonly apiKeys: { organizationId: string; apiKeyId: string }[] = [];
  /** Keyed `organizationId:userId`, as `organizationRoles` is: the same membership row. */
  readonly membershipStamps = new Map<string, AuthzMemoryMembershipStampRow>();
  /** Organizations that exist, as far as the bootstrap fence asks. */
  readonly organizations = new Set<string>();
  readonly auditLogs: AuthzAuditRow[] = [];

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
    this.membershipStamps.clear();
    this.organizations.clear();
    for (const rows of [
      this.admissions,
      this.admissionGrants,
      this.bindings,
      this.scopes,
      this.groupMemberships,
      this.legacySharedTeamMemberships,
      this.teamMemberships,
      this.grants,
      this.roleHeads,
      this.roles,
      this.shareLinks,
      this.apiKeys,
      this.auditLogs,
    ]) {
      rows.length = 0;
    }
  }
}
