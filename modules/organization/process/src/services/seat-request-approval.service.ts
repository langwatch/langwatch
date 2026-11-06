import { HandledError } from "@langwatch/handled-error";
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

type Dependencies = Readonly<{
  requests: SeatRequestRepository;
  members: OrganizationMembershipRepository;
  memberships: SeatRequestMemberships;
  seats: Pick<OrganizationSeatLicense, "checkLimit">;
  peers: Pick<SeatRequestPeers, "inviteMember">;
  now: () => number;
}>;

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
      return {
        outcome: await this.giveFullSeat({ organizationId, request, membership, isFull, by }),
      };
    } catch (error) {
      await this.dependencies.requests.release(claim);
      const refusal = readSeatRefusal(error);
      if (refusal.kind === "seat-limit")
        throw new MemberSeatLimitReachedError({ meta: refusal.limit });
      throw error;
    }
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
