import type { OrganizationMemberSeats } from "@langwatch/organization-contract";

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
  /**
   * Runs `work` while no other seat-taking write on the organization runs, so a count read
   * inside it still holds when the write lands. Never nested: a second hold on the same
   * organization from inside `work` waits on itself.
   */
  abstract withSeatLock<T>(input: { organizationId: string; work: () => Promise<T> }): Promise<T>;
}
