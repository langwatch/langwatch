import type { TenantDirectory } from "@langwatch/clickhouse-client";
import { PLATFORM_TENANT } from "@langwatch/clickhouse-client";
import { ProjectNotFoundError } from "@langwatch/project-contract";

import type { TenantOwnershipReader } from "../../services/tenant-directory.service.ts";
import type { MemoryOrganizationDatabase } from "./memory.organization.database.ts";

/** In-memory {@link TenantDirectory}, for tests and a memory-backed boot. */
export class MemoryTenantDirectoryRepository implements TenantDirectory, TenantOwnershipReader {
  private constructor(private readonly memory: MemoryOrganizationDatabase) {}

  static create(options: { memory: MemoryOrganizationDatabase }): MemoryTenantDirectoryRepository {
    return new MemoryTenantDirectoryRepository(options.memory);
  }

  async organizationForTenant(tenantId: string): Promise<string | null> {
    const project = this.memory.projects.get(tenantId);
    const projectOrganizationId = project
      ? this.memory.teams.get(project.teamId)?.organizationId
      : undefined;
    if (projectOrganizationId) return projectOrganizationId;
    if (await this.organizationExists(tenantId)) return tenantId;
    if (await this.userExists(tenantId)) return PLATFORM_TENANT;
    return null;
  }

  async getProjectOrganizationId(tenantId: string): Promise<string> {
    const project = this.memory.projects.get(tenantId);
    const organizationId = project
      ? this.memory.teams.get(project.teamId)?.organizationId
      : undefined;
    if (!organizationId)
      throw new ProjectNotFoundError("Project not found", { meta: { tenantId } });
    return organizationId;
  }

  async organizationExists(tenantId: string): Promise<boolean> {
    return this.memory.organizations.has(tenantId);
  }

  async userExists(tenantId: string): Promise<boolean> {
    return this.memory.users.has(tenantId);
  }
}
