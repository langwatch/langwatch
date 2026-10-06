import type { TenantSource } from "@langwatch/system-migrations";

import type {
  OrganizationMemberTenantSourceRepository,
  UserTenantSourceRepository,
} from "../user-tenant-source.repository.ts";

const NO_TENANTS: TenantSource = { findTenantIdsAfter: async () => [] };

/** The user table is not ops' to hold, so this tier walks no user. */
export class MemoryUserTenantSourceRepository implements UserTenantSourceRepository {
  static create(): MemoryUserTenantSourceRepository {
    return new MemoryUserTenantSourceRepository();
  }

  private constructor() {}

  async findTenantIdsAfter(_input: { cursor: string | null; limit: number }): Promise<string[]> {
    return [];
  }

  pendingFor(_input: { migrationNames: readonly string[] }): TenantSource {
    return this;
  }
}

/** Memberships are not ops' to hold, so this tier finds no organization's members. */
export class MemoryOrganizationMemberTenantSourceRepository implements OrganizationMemberTenantSourceRepository {
  static create(): MemoryOrganizationMemberTenantSourceRepository {
    return new MemoryOrganizationMemberTenantSourceRepository();
  }

  private constructor() {}

  membersOf(_input: { organizationId: string }): TenantSource {
    return NO_TENANTS;
  }
}
