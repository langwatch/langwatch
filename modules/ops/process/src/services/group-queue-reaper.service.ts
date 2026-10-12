import { createLogger } from "@langwatch/observability";
import type { OpsQueueReapedStrandedGroups } from "@langwatch/ops-contract";

import type { QueueAuditSink } from "../app/ops.app.ts";
import type { GroupQueueReaperRepository } from "../repositories/group-queue-reaper.repository.ts";

const logger = createLogger("langwatch:ops:group-queue-reaper");

/** Main's script default: a younger stranded group may still be mid-dispatch, so it stays. */
const STRANDED_MIN_AGE_HOURS = 6;
const LOGGED_GROUP_IDS = 100;
/** The queue whose default key prefix the repository reaps; the audit row's target. */
const REAPED_QUEUE_NAME = "event-sourcing/jobs";

/** Clears stuck queue groups, on the reaper's schedule or an operator's request. */
export class GroupQueueReaperService {
  private constructor(
    private readonly repository: GroupQueueReaperRepository,
    private readonly audit: QueueAuditSink | undefined,
  ) {}

  static create({
    repository,
    audit,
  }: {
    repository: GroupQueueReaperRepository;
    audit?: QueueAuditSink;
  }): GroupQueueReaperService {
    return new GroupQueueReaperService(repository, audit);
  }

  /** `audited` is false for the scheduled reap: only an operator's act is written down. */
  async reap({
    requestedBy,
    audited,
  }: {
    requestedBy: string;
    audited: boolean;
  }): Promise<OpsQueueReapedStrandedGroups> {
    const report = await this.repository.reapStrandedGroups({
      minAgeHours: STRANDED_MIN_AGE_HOURS,
    });
    const counts = {
      strandedGroups: report.strandedGroups,
      strandedJobs: report.strandedJobs,
      deletedGroups: report.deletedGroups,
      failedDeletes: report.failedDeletes,
      totalPendingNow: report.totalPendingNow,
    };
    if (counts.strandedGroups > 0) {
      const groupIds = report.groups.slice(0, LOGGED_GROUP_IDS).map((group) => group.groupId);
      logger.info({ requestedBy, ...counts, groupIds }, "reaped stranded queue groups");
    }
    if (counts.failedDeletes > 0) {
      logger.warn({ requestedBy, ...counts }, "some stranded queue groups could not be deleted");
    }
    if (audited && counts.deletedGroups > 0) {
      await this.audit?.append({
        actorUserId: requestedBy,
        action: "queue_reap_stranded",
        queueName: REAPED_QUEUE_NAME,
        metadata: { ...counts },
      });
    }
    return counts;
  }
}
