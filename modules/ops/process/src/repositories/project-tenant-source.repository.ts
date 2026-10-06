import type { TenantSource } from "@langwatch/system-migrations";

/** Projects in id order, for a migration on the project axis. */
export interface ProjectTenantSourceRepository extends TenantSource {
  getOrganizationId(projectId: string): Promise<string>;
}
