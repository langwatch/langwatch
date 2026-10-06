import type { ProjectTenantSourceRepository } from "../project-tenant-source.repository.ts";

/** The project table is not ops' to hold, so this tier walks no project. */
export class MemoryProjectTenantSourceRepository implements ProjectTenantSourceRepository {
  static create(): MemoryProjectTenantSourceRepository {
    return new MemoryProjectTenantSourceRepository();
  }

  private constructor() {}

  async findTenantIdsAfter(_input: { cursor: string | null; limit: number }): Promise<string[]> {
    return [];
  }

  async getOrganizationId(projectId: string): Promise<string> {
    throw new Error(`no project ${projectId} in the memory tier`);
  }
}
