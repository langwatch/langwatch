/**
 * Where tenants come from. The app implements this over the Organization
 * table; the page shape keeps one pass bounded in memory however many
 * tenants an installation has.
 */
export interface TenantSource {
  /**
   * Tenant ids after `cursor` in a stable order, at most `limit` of them.
   * An empty array ends the pass.
   */
  findTenantIdsAfter(args: {
    cursor: string | null;
    limit: number;
  }): Promise<string[]>;
}
