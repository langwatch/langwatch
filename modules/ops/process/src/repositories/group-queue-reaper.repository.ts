import type { ReapStrandedGroupsReport } from "@langwatch/group-queue/operational";

/** The group-queue keys no dispatcher will ever reach again, found and deleted. */
export abstract class GroupQueueReaperRepository {
  /** Deletes every group stranded for at least `minAgeHours` and recounts pending jobs. */
  abstract reapStrandedGroups(params: {
    minAgeHours: number;
    signal?: AbortSignal;
  }): Promise<ReapStrandedGroupsReport>;
}
