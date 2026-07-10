import { TRPCError } from "@trpc/server";
import type { RoleChangeType } from "./member-classification";
import type { ILicenseEnforcementRepository } from "./license-enforcement.repository";
import { getApp } from "~/server/app-layer/app";
import { captureException } from "~/utils/posthogErrorCapture";

/**
 * Error messages for license limit violations.
 * Consistent wording using "Lite Member" (not "External").
 */
export const LICENSE_LIMIT_ERRORS = {
  FULL_MEMBER_LIMIT: "Cannot complete action: full member limit reached",
  MEMBER_LITE_LIMIT: "Cannot complete action: Lite Member limit reached",
} as const;

/**
 * Subscription limits needed for member type limit checks. Callers pass the
 * resolved PlanInfo, which matches structurally — including the derived
 * billing profile the resolution is read from (ADR-039).
 */
export interface MemberTypeLimits {
  maxMembers: number;
  maxMembersLite: number;
  overrideAddingLimitations?: boolean;
  billing?: { memberPolicy: "purchase_seat" | "upgrade" | "hard_cap" };
}

/**
 * Asserts that a role change doesn't exceed license limits.
 * Throws TRPCError with FORBIDDEN code if limits would be exceeded.
 * Sends a fire-and-forget Slack notification to ops before throwing.
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

  const resolution = limits.billing?.memberPolicy ?? "upgrade";

  if (changeType === "lite-to-full") {
    const memberCount = await licenseRepo.getMemberCount(organizationId);
    if (memberCount >= limits.maxMembers) {
      void getApp()
        .usageLimits.notifyResourceLimitReached({
          organizationId,
          limitType: "members",
          current: memberCount,
          max: limits.maxMembers,
          resolution,
        })
        .catch(captureException);

      throw new TRPCError({
        code: "FORBIDDEN",
        message: LICENSE_LIMIT_ERRORS.FULL_MEMBER_LIMIT,
        cause: {
          limitType: "members",
          current: memberCount,
          max: limits.maxMembers,
          resolution,
        },
      });
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
          resolution,
        })
        .catch(captureException);

      throw new TRPCError({
        code: "FORBIDDEN",
        message: LICENSE_LIMIT_ERRORS.MEMBER_LITE_LIMIT,
        cause: {
          limitType: "membersLite",
          current: liteCount,
          max: limits.maxMembersLite,
          resolution,
        },
      });
    }
  }
}
