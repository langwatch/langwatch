import type { TenantSource } from "@langwatch/system-migrations";

import type { OrganizationTenantSourceRepository } from "../organization-tenant-source.repository.ts";

/** The organization table is not ops' to hold, so this tier walks no organization. */
export class MemoryOrganizationTenantSourceRepository implements OrganizationTenantSourceRepository {
  static create(): MemoryOrganizationTenantSourceRepository {
    return new MemoryOrganizationTenantSourceRepository();
  }

  private constructor() {}

  async findTenantIdsAfter(_input: { cursor: string | null; limit: number }): Promise<string[]> {
    return [];
  }

  pendingFor(_input: { migrationNames: readonly string[] }): TenantSource {
    return this;
  }
}
