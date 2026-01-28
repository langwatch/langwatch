import { TRPCError } from "@trpc/server";
import type { RoleChangeType } from "./member-classification";
import type { ILicenseEnforcementRepository } from "./license-enforcement.repository";

/**
 * Error messages for license limit violations.
 * Consistent wording using "Member Lite" (not "External").
 */
export const LICENSE_LIMIT_ERRORS = {
  FULL_MEMBER_LIMIT: "Cannot complete action: full member limit reached",
  MEMBER_LITE_LIMIT: "Cannot complete action: Member Lite limit reached",
} as const;

/**
 * Subscription limits needed for member type limit checks.
 */
export interface MemberTypeLimits {
  maxMembers: number;
  maxMembersLite: number;
  overrideAddingLimitations?: boolean;
}

/**
 * Asserts that a role change doesn't exceed license limits.
 * Throws TRPCError with FORBIDDEN code if limits would be exceeded.
 *
 * @throws TRPCError with code FORBIDDEN if limit exceeded
 */
export async function assertMemberTypeLimitNotExceeded(
  changeType: RoleChangeType,
  organizationId: string,
  licenseRepo: ILicenseEnforcementRepository,
  limits: MemberTypeLimits
): Promise<void> {
  // No limit check needed if type unchanged or limits overridden
  if (changeType === "no-change" || limits.overrideAddingLimitations) {
    return;
  }

  if (changeType === "lite-to-full") {
    const memberCount = await licenseRepo.getMemberCount(organizationId);
    if (memberCount >= limits.maxMembers) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: LICENSE_LIMIT_ERRORS.FULL_MEMBER_LIMIT,
      });
    }
  }

  if (changeType === "full-to-lite") {
    const liteCount = await licenseRepo.getMembersLiteCount(organizationId);
    if (liteCount >= limits.maxMembersLite) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: LICENSE_LIMIT_ERRORS.MEMBER_LITE_LIMIT,
      });
    }
  }
}
