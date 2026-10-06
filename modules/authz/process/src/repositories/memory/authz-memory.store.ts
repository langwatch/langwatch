import type { OrganizationRole } from "@langwatch/authorization";
import type {
  AuthzAccessUser,
  MigrationTenantStatus,
  TeamUserRole,
} from "@langwatch/authz-contract";
import type { Instant } from "@langwatch/time";

import type { AuthzAuditRow } from "../authz-audit-trail.repository.ts";
import type {
  AuthzAssignableRoleRow,
  AuthzManagedBindingRow,
  AuthzUserGroupRow,
} from "../authz-managed-grant.repository.ts";
import type {
  CompatShareLinkRowShape,
  GrantRowShape,
  RoleRowShape,
} from "../prisma/prisma.authz-grant.mapper.ts";

/** A user's standing as authz folded it from user's and identity's facts. */
type AuthzMemoryUserStandingRow = {
  deactivated: boolean;
  erased: boolean;
  changedAtMs: number;
};

/** A Grant head row: the projected fact, the revocation mark that ends it, the last write. */
export type AuthzMemoryGrantRow = GrantRowShape & {
  createdAt: Instant;
  revokedAt: Instant | null;
  revokedReason: string | null;
  updatedAt: Instant;
};

/** A Role head row; a deleted role keeps its row, marked. */
export type AuthzMemoryRoleRow = RoleRowShape & { deletedAt: Instant | null; updatedAt: Instant };

/** The RoleBinding compat head, with the moment its row was inserted. */
export type AuthzMemoryBindingRow = AuthzManagedBindingRow & { createdAt: Instant };

/** The CustomRole compat head the legacy resolver and the binding reads still read. */
export type AuthzMemoryCustomRoleRow = AuthzAssignableRoleRow & {
  organizationId: string;
  name: string;
  description: string | null;
  kind: string;
  createdAt: Instant;
};

/**
 * An OrganizationUser row: the role, the seat, the generation the grant fence
 * compares, and the grant an unfinished single-sign-on admission waits for.
 */
type AuthzMemoryMembershipRow = {
  role: OrganizationRole;
  disabled: boolean;
  membershipStamp: string;
  pendingSsoGrantId: string | null;
  createdAt: Instant;
};

/** A Group row; its members are `groupMemberships`. */
type AuthzMemoryGroupRow = AuthzUserGroupRow["group"] & { organizationId: string };

type AuthzMemoryApiKeyRow = {
  id: string;
  organizationId: string;
  name: string;
  userId: string | null;
  revokedAt: Instant | null;
};

/** A TeamUser row; its organization is its team's. */
type AuthzMemoryTeamRow = {
  id: string;
  organizationId: string;
  name: string;
  isPersonal: boolean;
  ownerUserId: string | null;
};

type AuthzMemoryInviteRow = {
  organizationId: string;
  email: string;
  status: "PENDING" | "ACCEPTED" | "WAITING_APPROVAL" | "PAYMENT_PENDING" | "REVOKED";
};

type AuthzMemoryTeamMembershipRow = {
  teamId: string;
  userId: string;
  role: TeamUserRole;
  assignedRoleId: string | null;
  createdAt: Instant;
};

type AuthzMemoryProjectRow = {
  id: string;
  teamId: string;
  name: string;
  isPersonal: boolean;
  apiKey: string;
  createdAt: Instant;
};

/** A share grant's counted views (GrantUsage). */
type AuthzMemoryGrantUsageRow = {
  grantId: string;
  organizationId: string;
  projectId: string;
  viewCount: number;
};

type AuthzMemoryCutoverRow = {
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
  readonly bindings: AuthzMemoryBindingRow[] = [];
  readonly users: Pick<AuthzAccessUser, "id" | "name" | "email" | "image">[] = [];
  /** Keyed `organizationId:userId`: the OrganizationUser row. */
  readonly memberships = new Map<string, AuthzMemoryMembershipRow>();
  readonly groups: AuthzMemoryGroupRow[] = [];
  readonly groupMemberships: { userId: string; groupId: string }[] = [];
  readonly teams: AuthzMemoryTeamRow[] = [];
  readonly teamMemberships: AuthzMemoryTeamMembershipRow[] = [];
  readonly projects: AuthzMemoryProjectRow[] = [];
  /** The grant ledger's Grant head, as the projection writes it. */
  readonly grants: AuthzMemoryGrantRow[] = [];
  readonly grantUsages: AuthzMemoryGrantUsageRow[] = [];
  readonly roleHeads: AuthzMemoryRoleRow[] = [];
  /** The CustomRole compat head. */
  readonly roles: AuthzMemoryCustomRoleRow[] = [];
  readonly shareLinks: (CompatShareLinkRowShape & { viewCount: number; createdAt: Instant })[] = [];
  readonly apiKeys: AuthzMemoryApiKeyRow[] = [];
  /** The OrganizationInvite rows offboarding clears by email. */
  readonly organizationInvites: AuthzMemoryInviteRow[] = [];
  /** Organizations that exist, as the bootstrap fence and the import ask. */
  readonly organizations = new Map<string, { name: string; createdAt: Instant }>();
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

  /** The key `memberships` holds an OrganizationUser row under. */
  membershipKey(organizationId: string, userId: string): string {
    return `${organizationId}:${userId}`;
  }

  isMember(organizationId: string, userId: string): boolean {
    return this.memberships.has(this.membershipKey(organizationId, userId));
  }

  isTeamIn(teamId: string, organizationId: string): boolean {
    return this.teams.some((team) => team.id === teamId && team.organizationId === organizationId);
  }

  isGroupIn(groupId: string, organizationId: string): boolean {
    return this.groups.some(
      (group) => group.id === groupId && group.organizationId === organizationId,
    );
  }

  reset(): void {
    this.epochs.clear();
    this.sessionVersions.clear();
    this.cutovers.clear();
    this.userStandings.clear();
    this.memberships.clear();
    this.organizations.clear();
    for (const rows of [
      this.bindings,
      this.users,
      this.groups,
      this.groupMemberships,
      this.teams,
      this.teamMemberships,
      this.projects,
      this.grants,
      this.grantUsages,
      this.roleHeads,
      this.roles,
      this.shareLinks,
      this.apiKeys,
      this.organizationInvites,
      this.auditLogs,
    ]) {
      rows.length = 0;
    }
  }
}
