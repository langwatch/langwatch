import { isViewOnlyCustomRole } from "@langwatch/entitlement-contract";

import type {
  OrganizationSeatRepository,
  SeatLease,
} from "../../../repositories/organization-seat.repository.ts";
import type { OrganizationInviteSeatCensus } from "../../../rules/invite-contracts.rules.ts";

/** The seat census an invitation is validated against: the SAME membership counts the seat
 * licence reads, narrowed to what the invite service asks of it. */
export class InviteSeatCensusService implements OrganizationInviteSeatCensus {
  static create(memberships: OrganizationSeatRepository): InviteSeatCensusService {
    return new InviteSeatCensusService(memberships);
  }

  private constructor(private readonly memberships: OrganizationSeatRepository) {}

  getMemberCount(organizationId: string): Promise<number> {
    return this.memberships.getMemberCount(organizationId);
  }

  getMembersLiteCount(organizationId: string): Promise<number> {
    return this.memberships.getMembersLiteCount(organizationId);
  }

  isViewOnlyCustomRole(permissions: string[]): boolean {
    return isViewOnlyCustomRole(permissions);
  }

  withSeatLock<T>(input: {
    organizationId: string;
    work: (lease: SeatLease) => Promise<T>;
  }): Promise<T> {
    return this.memberships.withSeatLock(input);
  }
}
