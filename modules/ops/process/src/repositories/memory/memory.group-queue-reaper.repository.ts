import type { ReapStrandedGroupsReport } from "@langwatch/group-queue/operational";

import { GroupQueueReaperRepository } from "../group-queue-reaper.repository.ts";

const EMPTY_REPORT: ReapStrandedGroupsReport = {
  mode: "apply",
  strandedGroups: 0,
  strandedJobs: 0,
  deletedGroups: 0,
  failedDeletes: 0,
  totalPendingNow: null,
  groups: [],
};

/** No queue in memory, so nothing is ever stranded; a test may set the report or a refusal. */
export class MemoryGroupQueueReaperRepository extends GroupQueueReaperRepository {
  report: ReapStrandedGroupsReport = EMPTY_REPORT;
  refusal: (() => Error) | null = null;
  readonly calls: { minAgeHours: number }[] = [];

  static create(): MemoryGroupQueueReaperRepository {
    return new MemoryGroupQueueReaperRepository();
  }

  async reapStrandedGroups({
    minAgeHours,
  }: {
    minAgeHours: number;
  }): Promise<ReapStrandedGroupsReport> {
    this.calls.push({ minAgeHours });
    if (this.refusal) throw this.refusal();
    return this.report;
  }
}
