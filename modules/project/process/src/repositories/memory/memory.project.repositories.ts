import type { ProjectRepositories } from "../project.repositories.ts";
import { MemoryProjectDatabase } from "./memory.project.database.ts";
import { MemoryProjectRepository } from "./memory.project.repository.ts";

export class MemoryProjectRepositories {
  static readonly requires = [] as const;

  static create(): ProjectRepositories {
    return { projects: MemoryProjectRepository.create({ memory: MemoryProjectDatabase.create() }) };
  }
}
