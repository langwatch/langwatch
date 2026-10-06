import type { OffboardCounts } from "@langwatch/authz-contract";
import type { Instant } from "@langwatch/time";

import type { AuthzReadRepository } from "./authz-read.repository.ts";
import type { GrantRowShape } from "./prisma/prisma.authz-grant.mapper.ts";
import type { AuthzGrantFilter } from "./prisma/prisma.authz-ledger.mapper.ts";

/** A binding's identity as the canonical Grant head stores it. */
export type LedgerGrantIdentity = Readonly<{
  principalType: string;
  principalId: string;
  roleKey: string;
  scopeType: string;
  scopeId: string;
}>;

/** A live role head's definition, as the read-your-writes hold compares it. */
export type LedgerRoleDefinition = Readonly<{
  name: string;
  description: string | null;
  permissions: unknown;
}>;

/** One grant the directory wrote, with the two instants a change view orders on. */
export type LedgerDirectoryGrantRow = Readonly<{
  id: string;
  principalId: string | null;
  createdAt: Instant;
  revokedAt: Instant | null;
}>;

/**
 * What the grants ledger and the grant writer read: the live Grant and Role heads the
 * read-your-writes hold polls, the identities a duplicate check matches, and the
 * offboarding transaction whose proof reads through a transaction-bound reader.
 */
export abstract class AuthzLedgerReadRepository {
  /** How many of these grants are live with their identity, written at or after `occurredSince`. */
  abstract countLandedGrants(input: {
    organizationId: string;
    grants: readonly (LedgerGrantIdentity & { id: string })[];
    occurredSince: Instant;
  }): Promise<number>;

  /** The live grants carrying one of these identities. */
  abstract findLiveGrantsByIdentity(input: {
    organizationId: string;
    identities: readonly LedgerGrantIdentity[];
  }): Promise<GrantRowShape[]>;

  /** One live grant by id, inside the organization when one is named. */
  abstract findLiveGrant(input: {
    grantId: string;
    organizationId?: string;
  }): Promise<GrantRowShape | null>;

  /** The role key one live grant carries, or null when there is no such grant. */
  abstract findLiveGrantRoleKey(input: {
    grantId: string;
    organizationId: string;
  }): Promise<{ roleKey: string | null } | null>;

  /** Whether a live grant with this id sits at this tier (and project, for a resource). */
  abstract hasLiveGrant(input: {
    grantId: string;
    organizationId: string;
    scopeType: "RESOURCE" | "PLATFORM";
    projectId?: string;
  }): Promise<boolean>;

  /** The ids of the live grants a translated compat filter names. */
  abstract findLiveGrantIds(input: { where: AuthzGrantFilter }): Promise<string[]>;

  /** A live role head's definition. */
  abstract findLiveRole(input: {
    roleId: string;
    organizationId: string;
  }): Promise<LedgerRoleDefinition | null>;

  abstract hasLiveRole(input: { roleId: string; organizationId: string }): Promise<boolean>;

  /** A live role by id alone: its owning organization and stored permissions. */
  abstract findLiveCustomRole(input: {
    roleId: string;
  }): Promise<{ organizationId: string; permissions: unknown } | null>;

  /** The live organization-scoped grants the directory wrote for these people. */
  abstract findDirectoryGrantIds(input: {
    organizationId: string;
    userIds: readonly string[];
  }): Promise<string[]>;

  /** The directory's grants newest-attached first, and its revoked ones newest-removed first. */
  abstract findDirectoryGrantHistory(input: {
    organizationId: string;
    limit: number;
  }): Promise<{ attached: LedgerDirectoryGrantRow[]; removed: LedgerDirectoryGrantRow[] }>;

  abstract findOwnedApiKeys(input: {
    userId: string;
    organizationId: string;
  }): Promise<{ id: string; name: string }[]>;

  abstract findPersonalTeams(input: {
    userId: string;
    organizationId: string;
  }): Promise<{ id: string; name: string }[]>;

  /**
   * End one membership in one transaction: delete the seat, hand its live grant ids to
   * `revoke`, clear the legacy rows, then `prove` through a reader bound to the transaction.
   * @throws OffboardIncompleteError when a live grant head survives the revoke.
   */
  abstract offboardUser(input: {
    userId: string;
    organizationId: string;
    revoke: (grantIds: string[]) => Promise<void>;
    prove: (reader: AuthzReadRepository) => Promise<void>;
  }): Promise<Omit<OffboardCounts, "bindings">>;
}
