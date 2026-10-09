import type { OrganizationMemberSeats } from "@langwatch/organization-contract";

/**
 * The seats an organization holds, read through organization's declared shares (R-C1f, Q9):
 * full and lite members, live invitations included, disabled and deactivated people excluded.
 */
export interface MemberSeatRepository {
  countMemberSeats(input: Readonly<{ organizationId: string }>): Promise<OrganizationMemberSeats>;
}
