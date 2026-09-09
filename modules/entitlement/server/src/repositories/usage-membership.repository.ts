/**
 * The membership and spend rows one organization's usage reading is taken
 * against. Deliberately NOT the message count: that one queries the analytics
 * store rather than the operational database.
 */
export interface UsageMembershipRepository {
  /** Full members: administrators, members, and lite members elevated by a custom role. */
  getMemberCount(organizationId: string): Promise<number>;
  /** Lite members: external users with no permission beyond viewing. */
  getMembersLiteCount(organizationId: string): Promise<number>;
  /** What every project in the organization has spent since the month began. */
  getCurrentMonthCost(organizationId: string): Promise<number>;
  /** The same spend, narrowed to a set of projects the caller already resolved. */
  getCurrentMonthCostForProjects(projectIds: string[]): Promise<number>;
}
