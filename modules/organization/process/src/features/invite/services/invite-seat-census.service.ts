import { isViewOnlyCustomRole } from "@langwatch/entitlement-contract";

import type { OrganizationSeatRepository } from "../../../repositories/organization-seat.repository.ts";
import type { OrganizationInviteSeatCensus } from "../../../rules/invite-contracts.rules.ts";
import type { SeatHoldService } from "../../../services/seat-hold.service.ts";

type InviteSeatHolds = Pick<SeatHoldService, "findHeldEmails" | "takeBackHeldSeat">;

/** The seat census an invitation is validated against: the SAME membership counts the seat
 * licence reads, narrowed to what the invite service asks of it. */
export class InviteSeatCensusService implements OrganizationInviteSeatCensus {
  static create(
    memberships: OrganizationSeatRepository,
    holds: InviteSeatHolds,
  ): InviteSeatCensusService {
    return new InviteSeatCensusService(memberships, holds);
  }

  private constructor(
    private readonly memberships: OrganizationSeatRepository,
    private readonly holds: InviteSeatHolds,
  ) {}

  getMemberCount(organizationId: string): Promise<number> {
    return this.memberships.getMemberCount(organizationId);
  }

  getMembersLiteCount(organizationId: string): Promise<number> {
    return this.memberships.getMembersLiteCount(organizationId);
  }

  isViewOnlyCustomRole(permissions: string[]): boolean {
    return isViewOnlyCustomRole(permissions);
  }

  findHeldEmails(input: { organizationId: string; emails: readonly string[] }): Promise<string[]> {
    return this.holds.findHeldEmails(input);
  }

  takeBackHeldSeat(input: {
    organizationId: string;
    userId: string;
    email?: string;
  }): Promise<boolean> {
    return this.holds.takeBackHeldSeat(input);
  }
}
