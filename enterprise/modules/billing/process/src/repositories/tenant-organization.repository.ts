/** Maps a tenant to its billable organization, or returns null for an orphan. */
export abstract class TenantOrganizationRepository {
  /** Null means the tenant has no organization; never a fallback to another. */
  abstract findOrganizationForTenant(tenantId: string): Promise<string | null>;
}
