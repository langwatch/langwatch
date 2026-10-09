import type { InMemoryProcessStore } from "@langwatch/eventing";

import type { UserRepositories } from "../user.repositories.ts";
import { MemoryGdprUserDataEraseRepository } from "./memory.user-data-erase.repository.ts";
import { MemoryUserOrganizationDirectoryRepository } from "./memory.user-organization-directory.repository.ts";
import { MemoryUserRateLimitRepository } from "./memory.user-rate-limit.repository.ts";
import { MemoryUserCredentialRepository } from "./memory.user-signin-credential.repository.ts";
import { MemoryUserDatabase } from "./memory.user.database.ts";
import { MemoryUserRepository } from "./memory.user.repository.ts";

/** User's memory stores over a database a test also holds, to read what its writes committed. */
export function memoryUserRepositoriesOver({
  database,
}: Readonly<{ database: MemoryUserDatabase }>): UserRepositories {
  return {
    users: MemoryUserRepository.create({ database }),
    credentials: MemoryUserCredentialRepository.create({ database }),
    rateLimits: MemoryUserRateLimitRepository.create(),
    organizationDirectory: MemoryUserOrganizationDirectoryRepository.create(),
    dataErase: MemoryGdprUserDataEraseRepository.create({ database }),
  };
}

export class MemoryUserRepositories {
  static readonly requires = ["processStore"] as const;

  static create({
    processStore,
  }: Readonly<{ processStore: InMemoryProcessStore }>): UserRepositories {
    return memoryUserRepositoriesOver({ database: MemoryUserDatabase.create({ processStore }) });
  }
}
