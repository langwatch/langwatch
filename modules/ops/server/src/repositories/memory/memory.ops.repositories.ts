import type { OpsRepositories } from "../ops.repositories.ts";
import { MemoryBugReportRepository } from "./memory.bug-report.repository.ts";
import { MemoryOpsStore } from "./memory.ops.store.ts";

/**
 * One store per composed process, shared by every twin, so a row one
 * repository writes is a row the next one reads.
 */
export class MemoryOpsRepositories {
  static readonly requires = [] as const;

  static create(): OpsRepositories {
    const store = MemoryOpsStore.create();

    return { bugReports: MemoryBugReportRepository.create({ store }) };
  }
}
