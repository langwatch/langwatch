/**
 * The membership and spend rows one organization's usage reading is taken
 * against. Deliberately NOT the message count: that one queries the analytics
 * store rather than the operational database.
 */
export interface UsageMembershipRepository {
  /** What every project in the organization has spent since the month began. */
  findCurrentMonthCost(organizationId: string): Promise<number>;
  /** The same spend, narrowed to a set of projects the caller already resolved. */
  findCurrentMonthCostForProjects(projectIds: string[]): Promise<number>;
}
