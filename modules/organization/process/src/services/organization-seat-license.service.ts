import type { OrganizationUserRole } from "@langwatch/authorization";
import { LimitExceededError } from "@langwatch/enterprise-licensing-contract";
import {
  getRoleChangeType,
  type EntitlementApi,
  type Plan,
  type PlanProviderUser,
  type RoleChangeType,
} from "@langwatch/entitlement-contract";
import type { LimitCheckResult, LimitType } from "@langwatch/organization-contract";

import type { OrganizationSeatRepository } from "../repositories/organization-seat.repository.ts";
import type { SeatLimitNoticeService } from "./seat-limit-notice.service.ts";

/**
 * The person a plan lookup is attributed to. Structural on purpose, since the licence store's
 * own user shape lives in an Enterprise package.
 */
export type OrganizationPlanUser = Readonly<{
  id: string;
  name?: string | null;
  email?: string | null;
}>;

/** What a seat check answers, counts included: the `licenseEnforcement.*` answer. */
export type OrganizationSeatDecision = LimitCheckResult;

/**
 * The seat and plan gates on a membership write. Deliberately two methods rather than the
 * platform's four: role classification, plan reads, seat counts, and the Enterprise custom-role
 * requirement are all one decision — "may this organization make this change on its plan."
 */
export interface OrganizationSeatLicense {
  /** Whether one more of `resource` fits inside the organization's plan. Answers rather than
   * throws, since only the caller knows how to turn a refusal into a named error. */
  checkLimit(input: {
    organizationId: string;
    resource: LimitType;
    user?: OrganizationPlanUser | undefined;
  }): Promise<OrganizationSeatDecision>;

  /**
   * Refuses a role change the organization's seats do not carry. Throws, never a soft answer.
   * The custom-role plan is declared on the door.
   */
  assertRoleChangeAllowed(input: {
    organizationId: string;
    currentRole: string;
    userPermissions: string[] | undefined;
    role: string;
    user?: OrganizationPlanUser | undefined;
  }): Promise<void>;
}

/** Seat licence over the same plan and membership counts; all fields answered. */
export class OrganizationSeatLicenseService implements OrganizationSeatLicense {
  static create(options: {
    plans: Pick<EntitlementApi, "getActivePlan">;
    memberships: OrganizationSeatRepository;
    notices: Pick<SeatLimitNoticeService, "reached">;
  }): OrganizationSeatLicenseService {
    return new OrganizationSeatLicenseService(options);
  }

  private constructor(
    private readonly options: {
      plans: Pick<EntitlementApi, "getActivePlan">;
      memberships: OrganizationSeatRepository;
      /** A refused role change is recorded before it is thrown, as main's guard did. */
      notices: Pick<SeatLimitNoticeService, "reached">;
    },
  ) {}

  async checkLimit(input: {
    organizationId: string;
    resource: LimitType;
    user?: OrganizationPlanUser | undefined;
  }): Promise<LimitCheckResult> {
    const plan = await this.activePlan(input.organizationId, input.user);
    const max = this.allowance(plan, input.resource);
    if (plan.overrideAddingLimitations) {
      return { allowed: true, limitType: input.resource, current: 0, max };
    }

    const current = await this.seatsTaken(input.organizationId, input.resource);
    return { allowed: current < max, limitType: input.resource, current, max };
  }

  async assertRoleChangeAllowed(input: {
    organizationId: string;
    currentRole: string;
    userPermissions: string[] | undefined;
    role: string;
    user?: OrganizationPlanUser | undefined;
  }): Promise<void> {
    const plan = await this.activePlan(input.organizationId, input.user);
    // The NEW role's permissions are deliberately not read: a built-in role
    // carries none, and a custom one is gated on the plan by the door, not on
    // a seat. That is the platform's own call, kept.
    const change = getRoleChangeType({
      oldRole: input.currentRole as OrganizationUserRole,
      oldPermissions: input.userPermissions,
      newRole: input.role as OrganizationUserRole,
      newPermissions: undefined,
    });
    await this.assertSeatForChange({ change, organizationId: input.organizationId, plan });
  }

  private async assertSeatForChange(input: {
    change: RoleChangeType;
    organizationId: string;
    plan: Plan;
  }): Promise<void> {
    // A move onto a Developer seat enters a pool no plan meters (ADR-171).
    if (
      input.change === "no-change" ||
      input.change === "to-developer" ||
      input.plan.overrideAddingLimitations
    )
      return;

    const resource = input.change === "lite-to-full" ? "members" : "membersLite";
    const max = this.allowance(input.plan, resource);
    const current = await this.seatsTaken(input.organizationId, resource);
    if (current >= max) {
      this.options.notices.reached({
        organizationId: input.organizationId,
        limitType: resource,
        current,
        max,
      });
      throw new LimitExceededError(resource, current, max);
    }
  }

  private activePlan(
    organizationId: string,
    user: OrganizationPlanUser | undefined,
  ): Promise<Plan> {
    // The plan application's own caller shape is the Enterprise licensing one
    // and the membership half may not name it, so the structural person the two
    // writes already carry is forwarded as it stands.
    return this.options.plans.getActivePlan({
      organizationId,
      ...(user ? { user: user as PlanProviderUser } : {}),
    });
  }

  private allowance(plan: Plan, resource: LimitType): number {
    return resource === "members" ? plan.maxMembers : plan.maxMembersLite;
  }

  private seatsTaken(organizationId: string, resource: LimitType): Promise<number> {
    return resource === "members"
      ? this.options.memberships.getMemberCount(organizationId)
      : this.options.memberships.getMembersLiteCount(organizationId);
  }
}
