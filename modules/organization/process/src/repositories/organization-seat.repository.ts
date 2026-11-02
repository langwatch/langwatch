import type { OrganizationMemberSeats } from "@langwatch/organization-contract";

import type { SeatHolder, SeatKind } from "../eventing/seat-peak.events.ts";

/** One holder and the seat it takes, classified as the counts above classify it. */
export type OrganizationSeatHolding = Readonly<{ holder: SeatHolder; seat: SeatKind }>;

/**
 * An organization's seats as they are counted for a licence and a plan: the full
 * and the lite members holding one, live invitations included. Disabled
 * memberships hold no access and hold no seat (seat-reconciliation.feature).
 */
export abstract class OrganizationSeatRepository {
  /** Members holding a FULL seat right now, live invitations included. */
  abstract getMemberCount(organizationId: string): Promise<number>;
  /** Members holding a LITE seat right now, live invitations included. */
  abstract getMembersLiteCount(organizationId: string): Promise<number>;
  /** Members holding a Developer seat (ADR-171): counted, never capped. */
  abstract getMembersDeveloperCount(organizationId: string): Promise<number>;
  /** All three in one read, for a check that asks after both pools at once. */
  abstract countMemberSeats(organizationId: string): Promise<OrganizationMemberSeats>;
  /** Every seat holder and its seat, live invitations included: the seat peak's opening count. */
  abstract findSeatHolders(organizationId: string): Promise<OrganizationSeatHolding[]>;
}
