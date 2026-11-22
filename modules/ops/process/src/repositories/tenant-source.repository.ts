import type { TenantSource } from "@langwatch/system-migrations";

/** Organizations in id order, the organization-rooted pass's tenants. */
export interface OrganizationTenantSourceRepository extends TenantSource {
  /** Only the organizations with work left in one of these migrations. */
  pendingFor(args: { migrationNames: readonly string[] }): TenantSource;
}

/**
 * A project whose team row is gone has no owning organization. The database carries no foreign
 * key (`relationMode = "prisma"`), so such an orphan can exist and must be told apart from a
 * real failure.
 */
export class ProjectHasNoOrganizationError extends Error {
  constructor(readonly projectId: string) {
    super(`Project ${projectId} has no owning team, so no organization`);
    this.name = "ProjectHasNoOrganizationError";
  }
}

/** Projects in id order, for a migration on the project axis. */
export interface ProjectTenantSourceRepository extends TenantSource {
  /** @throws {ProjectHasNoOrganizationError} when the project is an orphan. */
  getOrganizationId(projectId: string): Promise<string>;
  /** Each project's owning organization, in one read; unknown projects and orphans are left out. */
  findOrganizationIds(args: {
    projectIds: readonly string[];
  }): Promise<{ projectId: string; organizationId: string }[]>;
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
