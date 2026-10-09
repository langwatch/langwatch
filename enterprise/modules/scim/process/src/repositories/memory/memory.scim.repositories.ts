// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { ScimRepositories } from "../scim.repositories.ts";
import { MemoryScimSeatRepository } from "./memory.scim-seat.repository.ts";
import { MemoryScimSsoConnectionRepository } from "./memory.scim-sso-connection.repository.ts";
import { MemoryScimSyncProjectionRepository } from "./memory.scim-sync-projection.repository.ts";
import { MemoryScimRepository } from "./memory.scim.repository.ts";

/** SCIM on the memory tier: a process booted without a database. */
export class MemoryScimRepositories {
  static readonly requires = [] as const;

  static create(): ScimRepositories {
    return {
      scim: MemoryScimRepository.create(),
      scimSyncs: MemoryScimSyncProjectionRepository.create(),
      scimSsoConnections: MemoryScimSsoConnectionRepository.create(),
      seats: MemoryScimSeatRepository.create(),
    };
  }
}
