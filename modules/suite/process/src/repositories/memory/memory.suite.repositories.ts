import { RepositoryFoldStore, type FoldProjectionStore } from "@langwatch/eventing";
import { SUITE_RUN_PROJECTION_VERSIONS, type SuiteRunStateData } from "@langwatch/suite-contract";

import type { SuiteRunProcessingRepository } from "../suite-run-processing.repository.ts";
import type { SuiteRepositories } from "../suite.repositories.ts";
import { MemorySuiteRunRepository } from "./memory.suite-run.repository.ts";
import { MemorySuiteDatabase } from "./memory.suite.database.ts";
import { MemorySuiteRepository } from "./memory.suite.repository.ts";

/** The run fold held in this process; no cache, no analytical store. */
export class MemorySuiteRunProcessingRepository implements SuiteRunProcessingRepository {
  static create(): MemorySuiteRunProcessingRepository {
    return new MemorySuiteRunProcessingRepository();
  }

  private constructor() {}

  openRunStateFoldStore(): FoldProjectionStore<SuiteRunStateData> {
    return new RepositoryFoldStore(
      MemorySuiteRunRepository.create(),
      SUITE_RUN_PROJECTION_VERSIONS.RUN_STATE,
    );
  }
}

export class MemorySuiteRepositories {
  static readonly requires = [] as const;

  static create(): SuiteRepositories {
    return {
      suites: MemorySuiteRepository.create({ database: MemorySuiteDatabase.create() }),
      runProcessing: MemorySuiteRunProcessingRepository.create(),
    };
  }
}
