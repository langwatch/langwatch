import type { PlatformOperator } from "@langwatch/authz-contract";

/**
 * The PLATFORM tier of the grants head: live platform-operator grants, stored under the
 * platform tenant. Nothing organization-scoped reads or writes here. Whether a holder is
 * still active is the user-standing table's answer, asked by the service.
 */
export abstract class AuthzPlatformGrantRepository {
  /** Live grants, narrowed by id or holder when named; oldest first. */
  abstract findGrants(input: { grantId?: string; userId?: string }): Promise<PlatformOperator[]>;
}
