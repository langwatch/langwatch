// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { ScimRepositories } from "../scim.repositories.ts";
import { MemoryScimRepository } from "./memory.scim.repository.ts";

/** SCIM on the memory tier: a process booted without a database. */
export class MemoryScimRepositories {
  static readonly requires = [] as const;

  static create(): ScimRepositories {
    return { scim: MemoryScimRepository.create() };
  }
}
