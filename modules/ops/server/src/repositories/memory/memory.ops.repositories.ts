import type { OpsRepositories } from "../ops.repositories.ts";
import { MemoryBugReportRepository } from "./memory.bug-report.repository.ts";

export class MemoryOpsRepositories {
  static readonly requires = [] as const;

  static create(): OpsRepositories {
    return { bugReports: MemoryBugReportRepository.create() };
  }
}
