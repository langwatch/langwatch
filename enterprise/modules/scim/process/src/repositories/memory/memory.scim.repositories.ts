// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { OrganizationMemberSeats } from "@langwatch/organization-contract";

import type { ScimSeatRepository } from "../scim-seat.repository.ts";
import type { ScimRepositories } from "../scim.repositories.ts";
import { MemoryScimSsoConnectionRepository } from "./memory.scim-sso-connection.repository.ts";
import { MemoryScimSyncActivityRepository } from "./memory.scim-sync-activity.repository.ts";
import { MemoryScimSyncProjectionRepository } from "./memory.scim-sync-projection.repository.ts";
import { MemoryScimRepository } from "./memory.scim.repository.ts";

/** SCIM on the memory tier: a process booted without a database. */
export class MemoryScimRepositories {
  static readonly requires = [] as const;

  static create(): ScimRepositories {
    return {
      scim: MemoryScimRepository.create(),
      scimSyncs: MemoryScimSyncProjectionRepository.create(),
      scimSyncActivity: MemoryScimSyncActivityRepository.create(),
      scimSsoConnections: MemoryScimSsoConnectionRepository.create(),
      seats: MemoryScimSeatRepository.create(),
    };
  }
}

/** Holds no seats for any organization. */
export class MemoryScimSeatRepository implements ScimSeatRepository {
  static create(): MemoryScimSeatRepository {
    return new MemoryScimSeatRepository();
  }

  private constructor() {}

  async countMemberSeats(
    _input: Readonly<{ organizationId: string }>,
  ): Promise<OrganizationMemberSeats> {
    return { fullMembers: 0, liteMembers: 0, developers: 0 };
  }
}
