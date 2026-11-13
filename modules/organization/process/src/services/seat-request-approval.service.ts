import { HandledError } from "@langwatch/handled-error";
import type { Logger } from "@langwatch/observability";
import {
  MemberSeatLimitReachedError,
  OrganizationUserRole,
  SeatRequestNotFoundError,
  type SeatRequestResolved,
} from "@langwatch/organization-contract";

import type { OrganizationMembershipRepository } from "../repositories/organization-membership.repository.ts";
import type {
  SeatRequestRepository,
  SeatRequestRow,
} from "../repositories/seat-request.repository.ts";
import { readSeatRefusal } from "../rules/seat-limit-refusal.rules.ts";
import type {
  OrganizationSeatLicense,
  OrganizationPlanUser,
} from "./organization-seat-license.service.ts";
import type { SeatRequestMemberships, SeatRequestPeers } from "./seat-request.service.ts";

/** How often a claim whose seat could not be given is handed back before giving up. */
const RELEASE_ATTEMPTS = 3;
const RELEASE_PAUSE_MS = 100;
/**
 * An approval still giving its seat this long after it claimed the request never gave it: the
 * seat wait (15 s) and the writes are long done by then, so the request is reopened.
 */
export const SEAT_PENDING_GRACE_MS = 10 * 60 * 1000;

type Dependencies = Readonly<{
  requests: SeatRequestRepository;
  members: OrganizationMembershipRepository;
  memberships: SeatRequestMemberships;
  seats: Pick<OrganizationSeatLicense, "checkLimit">;
  peers: Pick<SeatRequestPeers, "inviteMember" | "hasOpenInvite">;
  now: () => number;
  logger: Pick<Logger, "warn">;
  wait?: (ms: number) => Promise<void>;
}>;

/** The claim an approval holds on its request while it gives the seat. */
type Claim = Readonly<{ organizationId: string; id: string; resolvedByUserId: string; at: number }>;

/** A claim that could not be handed back: the request reads APPROVED with no seat given. */
export class SeatRequestReleaseError extends Error {
  readonly claim: Claim;
  readonly refusal: unknown;
  readonly releaseFailure: unknown;

  constructor({
    claim,
    refusal,
    releaseFailure,
  }: {
    claim: Claim;
    refusal: unknown;
    releaseFailure: unknown;
  }) {
    super(`seat request ${claim.id} could not be reopened after its seat was refused`, {
      cause: releaseFailure,
    });
    this.name = "SeatRequestReleaseError";
    this.claim = claim;
    this.refusal = refusal;
    this.releaseFailure = releaseFailure;
  }
}

/**
 * Approving a seat request (modules/organization/specs/seat-requests.feature): claim the request,
 * give the full seat, and hand the claim back when the seat could not be given.
 */
export class SeatRequestApprovalService {
  static create(dependencies: Dependencies): SeatRequestApprovalService {
    return new SeatRequestApprovalService(dependencies);
  }

  private constructor(private readonly dependencies: Dependencies) {}

  /** Gives the full seat; refuses member_seat_limit_reached while no full seat is free. */
  async approve({
    organizationId,
    seatRequestId,
    by,
  }: {
    organizationId: string;
    seatRequestId: string;
    by: OrganizationPlanUser;
  }): Promise<SeatRequestResolved> {
    const { requests } = this.dependencies;
    const request = await requests.getOpen({ organizationId, id: seatRequestId });
    const membership = await this.membershipOf({ organizationId, request });
    const isFull =
      membership !== null &&
      (membership.role === OrganizationUserRole.MEMBER ||
        membership.role === OrganizationUserRole.ADMIN);
    // Claimed first, so a concurrent decline or second approval cannot also act on it.
    const claim = { organizationId, id: request.id, resolvedByUserId: by.id, at: this.now() };
    if (!(await requests.resolve({ ...claim, status: "APPROVED" }))) {
      throw new SeatRequestNotFoundError(request.id);
    }
    // The early check spares a doomed write; the writes giveFullSeat calls each re-check the
    // seat under the organization's seat lease, so of two approvals for the last seat one wins.
    try {
      if (!(isFull && membership.disabledAt === null)) {
        await this.assertFullSeatFree({ organizationId, by });
      }
      const outcome = await this.giveFullSeat({
        organizationId,
        request,
        membership,
        isFull,
        by,
      });
      await this.settle(claim);
      return { outcome };
    } catch (error) {
      await this.release({ claim, refusal: error });
      const refusal = readSeatRefusal(error);
      if (refusal.kind === "seat-limit")
        throw new MemberSeatLimitReachedError({ meta: refusal.limit });
      throw error;
    }
  }

  /**
   * Reopens approvals whose seat never landed (a crash between claim and seat write, or a claim
   * not handed back). One whose person is seated, or whose address holds an open invitation,
   * got its seat after all and is only marked settled.
   */
  async reopenStranded({ organizationId }: { organizationId: string }): Promise<void> {
    const { requests } = this.dependencies;
    const stranded = await requests.findSeatPending({
      organizationId,
      since: this.now() - SEAT_PENDING_GRACE_MS,
    });
    for (const request of stranded) {
      if (request.resolvedAt === null) continue;
      const at = request.resolvedAt;
      if (await this.gotSeat({ organizationId, request })) {
        await requests.settleSeat({ organizationId, id: request.id, at });
        continue;
      }
      await requests.release({
        organizationId,
        id: request.id,
        resolvedByUserId: request.resolvedByUserId,
        at,
      });
      this.dependencies.logger.warn(
        { organizationId, seatRequestId: request.id },
        "reopened an approved seat request whose seat never landed",
      );
    }
  }

  /** An enabled full membership, or for an address alone the invitation its approval sent. */
  private async gotSeat({
    organizationId,
    request,
  }: {
    organizationId: string;
    request: SeatRequestRow;
  }): Promise<boolean> {
    const membership = await this.membershipOf({ organizationId, request });
    if (
      membership !== null &&
      membership.disabledAt === null &&
      (membership.role === OrganizationUserRole.MEMBER ||
        membership.role === OrganizationUserRole.ADMIN)
    ) {
      return true;
    }
    return this.dependencies.peers.hasOpenInvite({ organizationId, email: request.email });
  }

  /**
   * Marks the seat given. The seat stands either way, so a failed mark is logged, not thrown;
   * reopenStranded later finds the person seated and only marks it settled.
   */
  private async settle(claim: Claim): Promise<void> {
    await this.dependencies.requests
      .settleSeat({ organizationId: claim.organizationId, id: claim.id, at: claim.at })
      .catch((error: unknown) => {
        this.dependencies.logger.warn(
          { error, organizationId: claim.organizationId, seatRequestId: claim.id },
          "could not mark a seat request's seat as given",
        );
      });
  }

  private now(): number {
    return this.dependencies.now();
  }

  private async membershipOf({
    organizationId,
    request,
  }: {
    organizationId: string;
    request: SeatRequestRow;
  }): Promise<{ role: OrganizationUserRole; disabledAt: unknown } | null> {
    if (!request.userId) return null;
    return this.dependencies.members
      .getMembership({ organizationId, userId: request.userId })
      .catch((error: unknown) => {
        if (HandledError.isHandled(error) && error.code === "member_not_found") return null;
        throw error;
      });
  }

  /**
   * Hands the claim back so the request is open again, retried: a request left APPROVED with
   * no seat drops off every list. A release that still fails is an infrastructure error naming
   * both failures, never the handled refusal that would tell the approver to just retry.
   */
  private async release({ claim, refusal }: { claim: Claim; refusal: unknown }): Promise<void> {
    const wait =
      this.dependencies.wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    let failure: unknown;
    for (let attempt = 0; attempt < RELEASE_ATTEMPTS; attempt++) {
      try {
        await this.dependencies.requests.release(claim);
        return;
      } catch (error) {
        failure = error;
        if (attempt + 1 < RELEASE_ATTEMPTS) await wait(RELEASE_PAUSE_MS * 2 ** attempt);
      }
    }
    throw new SeatRequestReleaseError({ claim, refusal, releaseFailure: failure });
  }

  private async assertFullSeatFree({
    organizationId,
    by,
  }: {
    organizationId: string;
    by: OrganizationPlanUser;
  }): Promise<void> {
    const result = await this.dependencies.seats.checkLimit({
      organizationId,
      resource: "members",
      user: by,
    });
    if (!result.allowed) {
      throw new MemberSeatLimitReachedError({
        meta: { limitType: result.limitType, current: result.current, max: result.max },
      });
    }
  }

  /** Lite becomes full, a held row becomes full and is enabled, an address alone is invited. */
  private async giveFullSeat({
    organizationId,
    request,
    membership,
    isFull,
    by,
  }: {
    organizationId: string;
    request: SeatRequestRow;
    membership: { role: OrganizationUserRole; disabledAt: unknown } | null;
    isFull: boolean;
    by: OrganizationPlanUser;
  }): Promise<SeatRequestResolved["outcome"]> {
    const { memberships, peers } = this.dependencies;
    if (!membership || !request.userId) {
      await peers.inviteMember({ organizationId, email: request.email, invitedBy: by });
      return "invited";
    }
    const userId = request.userId;
    const held = membership.disabledAt !== null;
    // A grant lands only on a live membership, so a held row is enabled before its role moves.
    if (held) {
      await memberships.setMemberDisabled({
        organizationId,
        userId,
        disabled: false,
        actingUser: by,
      });
    }
    if (!isFull) {
      try {
        // The approver's seat decision stands for the organization: the grant is the system's.
        await memberships.changeMemberRole({
          organizationId,
          userId,
          role: OrganizationUserRole.MEMBER,
          currentUserId: by.id,
          caller: { type: "system" },
        });
      } catch (error) {
        if (held) {
          await memberships.setMemberDisabled({
            organizationId,
            userId,
            disabled: true,
            actingUser: null,
          });
        }
        throw error;
      }
    }
    if (held) return "enabled";
    return isFull ? "already_member" : "promoted";
  }
}
