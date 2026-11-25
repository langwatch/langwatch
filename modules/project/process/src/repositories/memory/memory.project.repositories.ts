import type { ProjectRepositories } from "../project.repositories.ts";
import { MemoryProjectStorageSettingsRepository } from "./memory.project-storage-settings.repository.ts";
import { MemoryProjectDatabase } from "./memory.project.database.ts";
import { MemoryProjectRepository } from "./memory.project.repository.ts";

export class MemoryProjectRepositories {
  static readonly requires = [] as const;

  static create(): ProjectRepositories {
    const memory = MemoryProjectDatabase.create();

    return {
      projects: MemoryProjectRepository.create({ memory }),
      storageSettings: MemoryProjectStorageSettingsRepository.create({ memory }),
    };
  }
}
