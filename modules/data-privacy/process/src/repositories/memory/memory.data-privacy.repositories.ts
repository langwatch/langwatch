import type { DataPrivacyRepositories } from "../data-privacy.repositories.ts";
import { MemoryDataPrivacyDirectoryRepository } from "./memory.data-privacy-directory.repository.ts";
import { MemoryDataPrivacyPolicyRepository } from "./memory.data-privacy.repository.ts";

export class MemoryDataPrivacyRepositories {
  static readonly requires = [] as const;

  static create(): DataPrivacyRepositories {
    return {
      policies: MemoryDataPrivacyPolicyRepository.create(),
      directory: MemoryDataPrivacyDirectoryRepository.create(),
    };
  }
}
