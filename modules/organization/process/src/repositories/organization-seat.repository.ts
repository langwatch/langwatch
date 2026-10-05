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
  /**
   * Members holding a Developer seat (ADR-171), live invitations included. Shown on the plan
   * page, never compared to a limit.
   */
  abstract getMembersDeveloperCount(organizationId: string): Promise<number>;
}
