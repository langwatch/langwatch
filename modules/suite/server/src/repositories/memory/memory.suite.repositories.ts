import type { SuiteRepositories } from "../suite.repositories.ts";
import { MemorySuiteDatabase } from "./memory.suite.database.ts";
import { MemorySuiteRepository } from "./memory.suite.repository.ts";

export class MemorySuiteRepositories {
  static readonly requires = [] as const;

  static create(): SuiteRepositories {
    return { suites: MemorySuiteRepository.create({ database: MemorySuiteDatabase.create() }) };
  }
}
