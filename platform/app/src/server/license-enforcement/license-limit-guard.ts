import { getApp } from "~/server/app-layer/app";
import { captureException } from "~/utils/posthogErrorCapture";
import { LimitExceededError } from "./errors";
import type { ILicenseEnforcementRepository } from "./license-enforcement.repository";
import type { RoleChangeType } from "./member-classification";

/**
 * Error messages for license limit violations.
 * Consistent wording using "Lite Member" (not "External").
 *
 * Server copy and log lines only. What a customer reads comes from the
 * `resource_limit_exceeded` entry in the client presentation registry, keyed off
 * the code {@link LimitExceededError} carries, with the allowance itself read
 * from its `meta`.
 */
export const LICENSE_LIMIT_ERRORS = {
  FULL_MEMBER_LIMIT: "Cannot complete action: full member limit reached",
  MEMBER_LITE_LIMIT: "Cannot complete action: Lite Member limit reached",
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
 * Sends a fire-and-forget Slack notification to ops before throwing.
 *
 * The refusal is a {@link LimitExceededError}, so the allowance that ran out
 * travels as `meta` under a stable code and the client can name it. It used to
 * be a bare `TRPCError` whose whole answer was the sentence "Cannot complete
 * action", which is the least useful thing to tell an admin working down a
 * member list one seat at a time.
 *
 * @throws LimitExceededError if the limit would be exceeded
 */
export async function assertMemberTypeLimitNotExceeded(
  changeType: RoleChangeType,
  organizationId: string,
  licenseRepo: ILicenseEnforcementRepository,
  limits: MemberTypeLimits,
): Promise<void> {
  // No limit check needed if type unchanged or limits overridden
  if (changeType === "no-change" || limits.overrideAddingLimitations) {
    return;
  }

  if (changeType === "lite-to-full") {
    const memberCount = await licenseRepo.getMemberCount(organizationId);
    if (memberCount >= limits.maxMembers) {
      void getApp()
        .usageLimits.notifyResourceLimitReached({
          organizationId,
          limitType: "members",
          current: memberCount,
          max: limits.maxMembers,
        })
        .catch(captureException);

      throw new LimitExceededError("members", memberCount, limits.maxMembers);
    }
  }

  if (changeType === "full-to-lite") {
    const liteCount = await licenseRepo.getMembersLiteCount(organizationId);
    if (liteCount >= limits.maxMembersLite) {
      void getApp()
        .usageLimits.notifyResourceLimitReached({
          organizationId,
          limitType: "membersLite",
          current: liteCount,
          max: limits.maxMembersLite,
        })
        .catch(captureException);

      throw new LimitExceededError("membersLite", liteCount, limits.maxMembersLite);
    }
  }
}
