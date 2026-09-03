/**
 * The membership and spend rows one organization's usage reading is taken
 * against: how many people it has, how many of them are lite members, and what
 * it has spent this month.
 *
 * Deliberately NOT the message count — that one queries the analytics store
 * rather than the operational database, and putting it here would make a row
 * reader responsible for delegating to a second store.
 */
export abstract class UsageMembershipPort {
  /** Full members: administrators, members, and lite members elevated by a custom role. */
  abstract getMemberCount(organizationId: string): Promise<number>;
  /** Lite members: external users with no permission beyond viewing. */
  abstract getMembersLiteCount(organizationId: string): Promise<number>;
  /** What every project in the organization has spent since the month began. */
  abstract getCurrentMonthCost(organizationId: string): Promise<number>;
  /** The same spend, narrowed to a set of projects the caller already resolved. */
  abstract getCurrentMonthCostForProjects(projectIds: string[]): Promise<number>;
}
