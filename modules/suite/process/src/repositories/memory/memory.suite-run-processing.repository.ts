import { RepositoryFoldStore, type FoldProjectionStore } from "@langwatch/eventing";
import { SUITE_RUN_PROJECTION_VERSIONS, type SuiteRunStateData } from "@langwatch/suite-contract";

import type { SuiteRunProcessingRepository } from "../suite-run-processing.repository.ts";
import { MemorySuiteRunRepository } from "./memory.suite-run.repository.ts";

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
