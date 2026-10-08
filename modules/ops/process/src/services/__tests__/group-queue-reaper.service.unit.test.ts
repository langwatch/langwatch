/** Spec: modules/ops/specs/queue-stranded-groups.feature */
import { describe, expect, it } from "vitest";

import { MemoryGroupQueueReaperRepository } from "../../repositories/memory/memory.group-queue-reaper.repository.ts";
import { GroupQueueReaperService } from "../group-queue-reaper.service.ts";

function setup() {
  const repository = MemoryGroupQueueReaperRepository.create();
  return { repository, service: GroupQueueReaperService.create({ repository }) };
}

describe("GroupQueueReaperService", () => {
  /** @scenario "Clearing stuck groups deletes groups stranded six hours or more and reports what it freed" */
  it("reaps groups stranded six hours or more and returns the counts", async () => {
    const { repository, service } = setup();
    repository.report = {
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
    };

    const report = await service.reap({ requestedBy: "user_1" });

    expect(repository.calls).toEqual([{ minAgeHours: 6 }]);
    expect(report).toEqual({
      strandedGroups: 2,
      strandedJobs: 40,
      deletedGroups: 2,
      failedDeletes: 0,
      totalPendingNow: 10,
    });
  });

  /** @scenario "Clearing stuck groups surfaces a Redis failure to the operator" */
  it("rejects when the reap fails", async () => {
    const { repository, service } = setup();
    repository.refusal = () => new Error("READONLY You can't write against a read only replica.");

    await expect(service.reap({ requestedBy: "user_1" })).rejects.toThrow("READONLY");
  });

  /** @scenario "The memory tier has no stuck groups to clear" */
  it("reports nothing stranded on the memory tier", async () => {
    const { service } = setup();

    await expect(service.reap({ requestedBy: "user_1" })).resolves.toEqual({
      strandedGroups: 0,
      strandedJobs: 0,
      deletedGroups: 0,
      failedDeletes: 0,
      totalPendingNow: null,
    });
  });
});
