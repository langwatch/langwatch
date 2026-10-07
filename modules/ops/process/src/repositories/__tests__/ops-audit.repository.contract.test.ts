/**
 * @vitest-environment node
 * The operator trails' read contract over the memory twins. The acts are written
 * through the audit log by ops' audit services; the trails only list them.
 * @see modules/ops/specs/ops-store-seams.feature
 */
import { beforeEach, describe, expect, it } from "vitest";

import { MemoryOpsStore } from "../memory/memory.ops.store.ts";
import { MemoryProcessAuditRepository } from "../memory/memory.process-audit.repository.ts";
import { MemorySchedulerAuditRepository } from "../memory/memory.scheduler-audit.repository.ts";

describe("given the memory operator trails", () => {
  let store: MemoryOpsStore;

  beforeEach(() => {
    store = MemoryOpsStore.create();
  });

  describe("when process acts are held in ops' store", () => {
    /** @scenario "The operator trails list what ops' store holds, newest first" */
    it("lists at most the limit, newest first", async () => {
      for (const [index, key] of ["a", "b", "c"].entries()) {
        store.processAudit.push({
          id: `act-${key}`,
          createdAt: index,
          action: "process_wake_now",
          targetId: key,
          actorUserId: "user_ops",
          metadata: {},
        });
      }

      const listed = await MemoryProcessAuditRepository.create({ store }).findRecent({ limit: 2 });

      expect(listed.map((entry) => entry.targetId)).toEqual(["c", "b"]);
    });

    it("answers an empty trail before anything is recorded", async () => {
      expect(
        await MemoryProcessAuditRepository.create({ store }).findRecent({ limit: 10 }),
      ).toEqual([]);
    });
  });

  describe("when scheduler acts are held in ops' store", () => {
    it("lists them newest first with their schedule and project", async () => {
      for (const scheduleId of ["sched_1", "sched_2"]) {
        store.schedulerAudit.push({
          id: `act-${scheduleId}`,
          at: "2026-10-06T00:00:00.000Z",
          action: "ops.scheduler.run_now",
          scheduleId,
          projectId: "project-1",
          actor: "user_ops",
        });
      }

      const listed = await MemorySchedulerAuditRepository.create({ store }).findRecent({
        limit: 10,
      });

      expect(listed.map((entry) => entry.scheduleId)).toEqual(["sched_2", "sched_1"]);
    });

    it("answers an empty trail before anything is recorded", async () => {
      expect(
        await MemorySchedulerAuditRepository.create({ store }).findRecent({ limit: 10 }),
      ).toEqual([]);
    });
  });
});
