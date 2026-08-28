import type { RoleService } from "@langwatch/role-contract";
import { OrganizationUserRole, type PrismaClient } from "~/generated/prisma/client";
import { getApp } from "~/server/app-layer/app";
import type { PlanProvider } from "~/server/app-layer/subscription/plan-provider";
import { captureException } from "~/utils/posthogErrorCapture";
import { LimitExceededError } from "./errors";
import {
  LicenseEnforcementRepository,
  type ILicenseEnforcementRepository,
} from "./license-enforcement.repository";
import { getRoleChangeType, type RoleChangeType } from "./member-classification";

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

/**
 * Refuses a BUILT-IN team-role change for a Lite Member (`EXTERNAL`) that
 * would push the organization past the full-member seats its licence covers.
 *
 * A Lite Member gaining non-view permissions is a full member for seat
 * purposes, so the classification reads the role the binding carries today —
 * a custom role's permissions when it has one — and asks the seat guard about
 * the transition rather than the label. Only the built-in path reaches here;
 * assigning a custom role is gated on the Enterprise plan instead.
 *
 * Lifted out of `organization.updateTeamMemberRole` when that transport moved
 * to `@langwatch/organization-server`: the rule is licence enforcement, and it
 * belongs beside the other seat guards rather than inside a router.
 *
 * @throws LimitExceededError if the change would exceed the licence
 */
export async function assertExternalTeamRoleChangeWithinSeatLimits({
  prisma,
  roles,
  planProvider,
  organizationId,
  teamId,
  userId,
  actingUser,
}: {
  prisma: PrismaClient;
  roles: RoleService;
  planProvider: PlanProvider;
  organizationId: string;
  teamId: string;
  userId: string;
  actingUser?: { id: string; name?: string | null; email?: string | null };
}): Promise<void> {
  const currentBinding = await roles.tryGetUserBinding({
    userId,
    organizationId,
    teamId,
  });

  const oldPermissions = currentBinding?.customRoleId
    ? await (async () => {
        const role = await roles.tryGet({ roleId: currentBinding.customRoleId });
        return role?.permissions as string[] | undefined;
      })()
    : undefined;

  const changeType = getRoleChangeType(
    OrganizationUserRole.EXTERNAL,
    oldPermissions,
    OrganizationUserRole.EXTERNAL,
    undefined,
  );

  const subscriptionLimits = await planProvider.getActivePlan({
    organizationId,
    user: actingUser,
  });
  const licenseRepo = new LicenseEnforcementRepository(prisma);
  await assertMemberTypeLimitNotExceeded(
    changeType,
    organizationId,
    licenseRepo,
    subscriptionLimits,
  );
}
