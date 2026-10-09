/** Spec: modules/ops/specs/queue-stranded-groups.feature */
import { describe, expect, it } from "vitest";

import type { QueueAuditSink } from "../../app/ops.app.ts";
import { MemoryGroupQueueReaperRepository } from "../../repositories/memory/memory.group-queue-reaper.repository.ts";
import { GroupQueueReaperService } from "../group-queue-reaper.service.ts";

type AuditEntry = Parameters<QueueAuditSink["append"]>[0];

function setup() {
  const repository = MemoryGroupQueueReaperRepository.create();
  const entries: AuditEntry[] = [];
  const audit: QueueAuditSink = {
    append: async (entry) => {
      entries.push(entry);
    },
  };
  return { repository, entries, service: GroupQueueReaperService.create({ repository, audit }) };
}

const TWO_DELETED = {
  mode: "apply",
  strandedGroups: 2,
  strandedJobs: 40,
  deletedGroups: 2,
  failedDeletes: 0,
  totalPendingNow: 10,
  groups: [
    { groupId: "a", jobsKey: "a:jobs", dataKey: "a:data", jobCount: 30 },
    { groupId: "b", jobsKey: "b:jobs", dataKey: "b:data", jobCount: 10 },
  ],
} as const;

describe("GroupQueueReaperService", () => {
  /** @scenario "Clearing stuck groups deletes groups stranded six hours or more and reports what it freed" */
  it("reaps groups stranded six hours or more and returns the counts", async () => {
    const { repository, service } = setup();
    repository.report = TWO_DELETED;

    const report = await service.reap({ requestedBy: "user_1", audited: true });

    expect(repository.calls).toEqual([{ minAgeHours: 6 }]);
    expect(report).toEqual({
      strandedGroups: 2,
      strandedJobs: 40,
      deletedGroups: 2,
      failedDeletes: 0,
      totalPendingNow: 10,
    });
  });

  /** @scenario "Clearing stuck groups writes an audit entry naming the operator" */
  it("writes a queue_reap_stranded audit entry for an operator's reap", async () => {
    const { repository, entries, service } = setup();
    repository.report = TWO_DELETED;

    await service.reap({ requestedBy: "user_1", audited: true });

    expect(entries).toEqual([
      {
        actorUserId: "user_1",
        action: "queue_reap_stranded",
        queueName: "event-sourcing/jobs",
        metadata: {
          strandedGroups: 2,
          strandedJobs: 40,
          deletedGroups: 2,
          failedDeletes: 0,
          totalPendingNow: 10,
        },
      },
    ]);
  });

  /** @scenario "A scheduled reap writes no audit entry" */
  it("writes no audit entry for a scheduled reap", async () => {
    const { repository, entries, service } = setup();
    repository.report = TWO_DELETED;

    await service.reap({ requestedBy: "ops_group_queue_reaper", audited: false });

    expect(entries).toEqual([]);
  });

  /** @scenario "Clearing stuck groups surfaces a Redis failure to the operator" */
  it("rejects when the reap fails", async () => {
    const { repository, service } = setup();
    repository.refusal = () => new Error("READONLY You can't write against a read only replica.");

    await expect(service.reap({ requestedBy: "user_1", audited: true })).rejects.toThrow(
      "READONLY",
    );
  });

  /** @scenario "The memory tier has no stuck groups to clear" */
  it("reports nothing stranded on the memory tier and audits nothing", async () => {
    const { entries, service } = setup();

    await expect(service.reap({ requestedBy: "user_1", audited: true })).resolves.toEqual({
      strandedGroups: 0,
      strandedJobs: 0,
      deletedGroups: 0,
      failedDeletes: 0,
      totalPendingNow: null,
    });
    expect(entries).toEqual([]);
  });
});
