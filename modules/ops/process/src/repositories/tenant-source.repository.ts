import type { TenantSource } from "@langwatch/system-migrations";

/** Organizations in id order, the organization-rooted pass's tenants. */
export interface OrganizationTenantSourceRepository extends TenantSource {
  /** Only the organizations with work left in one of these migrations. */
  pendingFor(args: { migrationNames: readonly string[] }): TenantSource;
}

/** Projects in id order, for a migration on the project axis. */
export interface ProjectTenantSourceRepository extends TenantSource {
  getOrganizationId(projectId: string): Promise<string>;
}

/** Users in id order, the user-rooted leg's tenants. */
export interface UserTenantSourceRepository extends TenantSource {
  /** Only the users with work left in one of these migrations. */
  pendingFor(args: { migrationNames: readonly string[] }): TenantSource;
}

/** One organization's member users, for a targeted run of a user-rooted migration. */
export interface OrganizationMemberTenantSourceRepository {
  membersOf(args: { organizationId: string }): TenantSource;
}
