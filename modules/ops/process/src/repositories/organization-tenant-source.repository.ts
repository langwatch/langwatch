import type { TenantSource } from "@langwatch/system-migrations";

/** Organizations in id order, the organization-rooted pass's tenants. */
export interface OrganizationTenantSourceRepository extends TenantSource {
  /** Only the organizations with work left in one of these migrations. */
  pendingFor(args: { migrationNames: readonly string[] }): TenantSource;
}
