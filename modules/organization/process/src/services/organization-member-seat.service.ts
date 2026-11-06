/**
 * The seat a membership write takes or leaves (specs/licensing/seat-rotation.feature): what an
 * enable or a role change does to it, and the people waiting who take a freed full seat.
 */
import type { AuthzGrantCaller } from "@langwatch/authz-contract";
import { getRoleChangeType, isFullMember } from "@langwatch/entitlement-contract";
import {
  MemberSeatLimitReachedError,
  OrganizationUserRole,
} from "@langwatch/organization-contract";

import type { OrganizationMembershipRepository } from "../repositories/organization-membership.repository.ts";
import type { SeatTransition } from "../repositories/seat-hold.repository.ts";
import type { OrganizationMemberAdmissionService } from "./organization-member-admission.service.ts";
import type {
  OrganizationGrantCache,
  OrganizationSeatRevocationNotice,
} from "./organization-member-role.service.ts";
import type {
  OrganizationPlanUser,
  OrganizationSeatLicense,
} from "./organization-seat-license.service.ts";
import type {
  SeatHoldCheckFailure,
  SeatHoldCheckOutcome,
  SeatHoldService,
} from "./seat-hold.service.ts";

type OrganizationMemberSeatDependencies = {
  repository: OrganizationMembershipRepository;
  seats: OrganizationSeatLicense;
  seatNotices: OrganizationSeatRevocationNotice;
  grantCache: OrganizationGrantCache;
  seatHolds: SeatHoldService;
  admission: Pick<OrganizationMemberAdmissionService, "deleteMember">;
};

export class OrganizationMemberSeatService {
  static create(dependencies: OrganizationMemberSeatDependencies): OrganizationMemberSeatService {
    return new OrganizationMemberSeatService(dependencies);
  }

  private constructor(private readonly dependencies: OrganizationMemberSeatDependencies) {}

  private get repo(): OrganizationMembershipRepository {
    return this.dependencies.repository;
  }

  /**
   * The seat an enable takes, checked against the member's pool: a full member takes their hold
   * back or a free full seat, a Lite Member a free Lite seat, a Developer no capped seat.
   */
  async seatOnEnable({
    organizationId,
    userId,
    actingUser,
  }: {
    organizationId: string;
    userId: string;
    actingUser: OrganizationPlanUser | undefined;
  }): Promise<SeatTransition> {
    const { seatHolds, seats } = this.dependencies;
    const [standing] = await this.repo.findSeatStandings({ organizationId, userId });
    // An unread standing is checked as a full seat, the strictest pool.
    const type = standing
      ? await seatHolds.memberTypeOf({ organizationId, userId, standing })
      : "FullMember";
    const takesHoldBack =
      type === "FullMember" && (await seatHolds.hasLiveHold({ organizationId, userId }));
    if (type !== "Developer" && !takesHoldBack) {
      const result = await seats.checkLimit({
        organizationId,
        resource: type === "FullMember" ? "members" : "membersLite",
        user: actingUser,
      });
      if (!result.allowed) {
        throw new MemberSeatLimitReachedError({
          meta: { limitType: result.limitType, current: result.current, max: result.max },
        });
      }
    }
    if (!standing || standing.disabledAt === null || type !== "FullMember") {
      return { kind: "unchanged" };
    }
    return seatHolds.takeOf({ organizationId, userId });
  }

  /**
   * What a role change does to the seat, refused when the plan has no seat for it. A person
   * taking back their own held seat is not asked for a second one.
   */
  async seatOnRoleChange(input: {
    organizationId: string;
    userId: string;
    active: boolean;
    oldRole: OrganizationUserRole;
    oldPermissions: string[] | undefined;
    role: OrganizationUserRole;
    planUser: OrganizationPlanUser | undefined;
  }): Promise<SeatTransition> {
    const { organizationId, userId } = input;
    const seat = await this.transitionOnRoleChange(input);
    if (
      seat.kind !== "taken" ||
      !(await this.dependencies.seatHolds.hasLiveHold({ organizationId, userId }))
    ) {
      await this.dependencies.seats.assertRoleChangeAllowed({
        organizationId,
        currentRole: input.oldRole,
        userPermissions: input.oldPermissions,
        role: input.role,
        user: input.planUser,
      });
    }
    return seat;
  }

  /**
   * Removes a member and, when the seat frees at once and a full seat fits, gives it to the
   * person waiting the caller named. Answers who got the seat.
   */
  async removeMember(params: {
    organizationId: string;
    userId: string;
    actingUserId: string | null;
    giveSeatToUserId?: string | null;
    caller: AuthzGrantCaller;
  }): Promise<{ seatGivenToUserId: string | null }> {
    const { organizationId, userId, actingUserId, giveSeatToUserId, caller } = params;
    await this.dependencies.admission.deleteMember({ organizationId, userId, actingUserId });
    if (!giveSeatToUserId) return { seatGivenToUserId: null };
    const admitted = await this.admitWaitingMember({
      organizationId,
      userId: giveSeatToUserId,
      actingUserId,
      caller,
    });
    return { seatGivenToUserId: admitted ? giveSeatToUserId : null };
  }

  /**
   * Gives a full seat to a person admission left waiting: their membership becomes MEMBER and is
   * enabled. Answers false, changing nothing, when they no longer wait or no full seat fits.
   */
  async admitWaitingMember({
    organizationId,
    userId,
    actingUserId,
    caller,
  }: {
    organizationId: string;
    userId: string;
    actingUserId: string | null;
    caller: AuthzGrantCaller;
  }): Promise<boolean> {
    const { seatHolds, seats, seatNotices, grantCache } = this.dependencies;
    if (!(await seatHolds.isWaiting({ organizationId, userId }))) return false;
    if (!(await seatHolds.hasLiveHold({ organizationId, userId }))) {
      const fit = await seats.checkLimit({ organizationId, resource: "members" });
      if (!fit.allowed) return false;
    }
    // The role first, while the membership is still disabled: access comes with the enable.
    await this.repo.updateMemberRole({
      organizationId,
      userId,
      role: OrganizationUserRole.MEMBER,
      effectiveTeamRoleUpdates: [],
      currentUserId: actingUserId,
      caller,
      seat: await seatHolds.takeOf({ organizationId, userId }),
    });
    await this.repo.setMemberDisabled({ organizationId, userId, disabled: false });
    await seatNotices.memberEnabled({ organizationId, userId, enabledByUserId: actingUserId });
    await grantCache.invalidateOrganization({ organizationId });
    return true;
  }

  /**
   * The hourly seat hold check: in each organization with ended holds, gives free full seats to
   * the people waiting longest, then deletes those holds. An organization that fails keeps its
   * ended holds (they no longer count) so the next check retries it; the others go on.
   */
  async runSeatHoldCheck(): Promise<SeatHoldCheckOutcome> {
    const { seatHolds } = this.dependencies;
    const now = seatHolds.now();
    let admitted = 0;
    const failures: SeatHoldCheckFailure[] = [];
    for (const organizationId of await seatHolds.findOrganizationsWithEnded({ now })) {
      try {
        admitted += await this.admitWaitingMembers({ organizationId });
        await seatHolds.deleteEnded({ organizationId, now });
      } catch (error) {
        failures.push({
          organizationId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return { admitted, failures };
  }

  /** Gives free full seats to the people waiting longest; answers how many were admitted. */
  private async admitWaitingMembers({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<number> {
    let admitted = 0;
    for (const waiting of await this.dependencies.seatHolds.findWaitingMembers({
      organizationId,
    })) {
      const given = await this.admitWaitingMember({
        organizationId,
        userId: waiting.userId,
        actingUserId: null,
        caller: { type: "system" },
      });
      if (!given) break;
      admitted += 1;
    }
    return admitted;
  }

  /** A role change onto a full seat takes one; one off a full seat leaves its hold. */
  private async transitionOnRoleChange({
    organizationId,
    userId,
    active,
    oldRole,
    oldPermissions,
    role,
  }: {
    organizationId: string;
    userId: string;
    active: boolean;
    oldRole: OrganizationUserRole;
    oldPermissions: string[] | undefined;
    role: OrganizationUserRole;
  }): Promise<SeatTransition> {
    // A disabled membership holds no seat, so changing its role moves none.
    if (!active) return { kind: "unchanged" };
    const change = getRoleChangeType({
      oldRole,
      oldPermissions,
      newRole: role,
      newPermissions: undefined,
    });
    const { seatHolds } = this.dependencies;
    if (change === "lite-to-full") return seatHolds.takeOf({ organizationId, userId });
    const leavesFullSeat =
      change === "full-to-lite" ||
      (change === "to-developer" && isFullMember(oldRole, oldPermissions));
    if (!leavesFullSeat) return { kind: "unchanged" };
    return seatHolds.releaseOf({ organizationId, userId, reason: "DEMOTED" });
  }
}
