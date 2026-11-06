/**
 * The seat a membership write takes or leaves (specs/licensing/seat-rotation.feature): what an
 * enable or a role change does to it, and the people waiting who take a freed full seat.
 */
import { SYSTEM_ACTORS } from "@langwatch/authorization";
import { newAuthzGrantId, type AuthzGrantCaller } from "@langwatch/authz-contract";
import { getRoleChangeType, isFullMember } from "@langwatch/entitlement-contract";
import { createLogger } from "@langwatch/observability";
import {
  MemberSeatLimitReachedError,
  type OrganizationUserRole,
} from "@langwatch/organization-contract";

import type { OrganizationMembershipRepository } from "../repositories/organization-membership.repository.ts";
import type { SeatTransition } from "../repositories/seat-hold.repository.ts";
import type {
  OrganizationAdmissions,
  OrganizationMemberAdmissionService,
} from "./organization-member-admission.service.ts";
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
  admissions: OrganizationAdmissions;
};

const logger = createLogger("langwatch:organization:member-seats");

/** Unfinished admissions one seat hold check finishes at most. */
const UNFINISHED_ADMISSIONS_PER_CHECK = 100;

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
   * person waiting the caller named. The removal stands even when the handover fails: the answer
   * says so, and the person keeps waiting for the next free seat.
   */
  async removeMember(params: {
    organizationId: string;
    userId: string;
    actingUserId: string | null;
    giveSeatToUserId?: string | null;
    caller: AuthzGrantCaller;
  }): Promise<{ seatGivenToUserId: string | null; seatHandoverFailed: boolean }> {
    const { organizationId, userId, actingUserId, giveSeatToUserId, caller } = params;
    await this.dependencies.admission.deleteMember({ organizationId, userId, actingUserId });
    if (!giveSeatToUserId) return { seatGivenToUserId: null, seatHandoverFailed: false };
    try {
      const admitted = await this.admitWaitingMember({
        organizationId,
        userId: giveSeatToUserId,
        actingUserId,
        caller,
      });
      return { seatGivenToUserId: admitted ? giveSeatToUserId : null, seatHandoverFailed: false };
    } catch (error) {
      logger.error({ error, organizationId }, "seat handover after a removal failed");
      return { seatGivenToUserId: null, seatHandoverFailed: true };
    }
  }

  /**
   * Gives a full seat to a person admission left waiting: their membership becomes MEMBER and is
   * enabled. Answers false, changing nothing, when they no longer wait or no full seat fits. Once
   * enabled the seat is theirs: a grant that fails after it is left for the seat hold check.
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
    // One write turns the waiting row into an enabled MEMBER carrying its grant intent; the grant
    // needs a live membership, so it lands after, and an unfinished one resumes (ADR-129).
    const grantId = newAuthzGrantId();
    const enabled = await this.repo.admitWaitingMember({
      organizationId,
      userId,
      pendingAdmissionId: grantId,
      seat: await seatHolds.takeOf({ organizationId, userId }),
    });
    if (!enabled) return false;
    try {
      await this.finishAdmission({ organizationId, userId, grantId, actingUserId, caller });
    } catch (error) {
      logger.error(
        { error, organizationId, userId },
        "admitted member's grant failed; the seat hold check finishes it",
      );
      return true;
    }
    // The member is in from here: a failed notice or cache drop must not report the seat as lost.
    await Promise.all([
      seatNotices.memberEnabled({ organizationId, userId, enabledByUserId: actingUserId }),
      grantCache.invalidateOrganization({ organizationId }),
    ]).catch((error: unknown) => {
      logger.error(
        { error, organizationId },
        "notice or cache drop after admitting a member failed",
      );
    });
    return true;
  }

  /** Lands the member grant an admission from waiting intends, then clears the intent. */
  private async finishAdmission({
    organizationId,
    userId,
    grantId,
    actingUserId,
    caller,
  }: {
    organizationId: string;
    userId: string;
    grantId: string;
    actingUserId: string | null;
    caller: AuthzGrantCaller;
  }): Promise<void> {
    const { admissions } = this.dependencies;
    await admissions.attachBindings({
      organizationId,
      bindings: [
        {
          bindingId: grantId,
          principal: { userId },
          role: "MEMBER",
          customRoleId: null,
          scopeType: "ORGANIZATION",
          scopeId: organizationId,
        },
      ],
      caller,
      actor: actingUserId
        ? { type: "user", id: actingUserId }
        : { type: "system", id: SYSTEM_ACTORS.organizationService },
      source: "grants-service",
      onDuplicate: "skip",
      requireProjection: true,
    });
    await admissions.completeAdmission({ organizationId, userId, grantId });
  }

  /** Finishes admissions whose grant failed after the enable; the same grant id keeps it safe. */
  private async resumeUnfinishedAdmissions(): Promise<SeatHoldCheckFailure[]> {
    const failures: SeatHoldCheckFailure[] = [];
    const unfinished = await this.repo
      .findUnfinishedSeatAdmissions({ limit: UNFINISHED_ADMISSIONS_PER_CHECK })
      .catch((error: unknown) => {
        logger.error({ error }, "reading unfinished admissions failed; the next check retries");
        return [];
      });
    for (const { organizationId, userId, grantId } of unfinished) {
      try {
        await this.finishAdmission({
          organizationId,
          userId,
          grantId,
          actingUserId: null,
          caller: { type: "system" },
        });
        await this.dependencies.grantCache.invalidateOrganization({ organizationId });
      } catch (error) {
        failures.push({
          organizationId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return failures;
  }

  /**
   * The hourly seat hold check: where holds ended, gives free full seats to the people waiting
   * longest, then deletes those holds; a failing organization keeps them for the next check. Last,
   * it finishes admissions whose grant failed after the enable.
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
    failures.push(...(await this.resumeUnfinishedAdmissions()));
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
