/**
 * @vitest-environment node
 * The operator trails' contract, stated once and run over every backend: the
 * memory twins today, the Postgres pair when a test database is named.
 * @see specs/ops/dead-letter-recovery.feature
 */
import { beforeEach, describe, expect, it } from "vitest";

import { MemoryOpsStore } from "../memory/memory.ops.store.ts";
import { MemoryProcessAuditRepository } from "../memory/memory.process-audit.repository.ts";
import { MemorySchedulerAuditRepository } from "../memory/memory.scheduler-audit.repository.ts";
import type { ProcessAuditSink, SchedulerAuditSink } from "../ops-audit.repository.ts";

interface Backend {
  processes: () => ProcessAuditSink;
  schedules: () => SchedulerAuditSink;
}

function contractCases(backend: Backend): void {
  describe("when a process act is recorded", () => {
    it("lists it back with its actor and action", async () => {
      await backend.processes().append({
        actorUserId: "user_ops",
        action: "process_wake_now",
        processName: "webhookDelivery",
        projectId: "project-1",
        processKey: "endpoint:whep_1",
      });

      const listed = await backend.processes().listRecent({ limit: 10 });

      expect(listed).toHaveLength(1);
      expect(listed[0]).toMatchObject({
        actorUserId: "user_ops",
        action: "process_wake_now",
        targetId: "endpoint:whep_1",
      });
    });

    it("records a fleet-scoped act that names no one process", async () => {
      await backend.processes().append({
        actorUserId: "user_ops",
        action: "process_redrive_dead_letters",
        processName: null,
        projectId: null,
        processKey: null,
        metadata: { moved: 12 },
      });

      expect(await backend.processes().listRecent({ limit: 10 })).toHaveLength(1);
    });

    it("answers an empty trail before anything is recorded", async () => {
      expect(await backend.processes().listRecent({ limit: 10 })).toEqual([]);
    });

    it("returns at most the limit asked for", async () => {
      for (const key of ["a", "b", "c"]) {
        await backend.processes().append({
          actorUserId: "user_ops",
          action: "process_wake_now",
          processName: "webhookDelivery",
          projectId: "project-1",
          processKey: key,
        });
      }

      expect(await backend.processes().listRecent({ limit: 2 })).toHaveLength(2);
    });
  });

  describe("when a scheduler act is recorded", () => {
    it("lists it back with its schedule and project", async () => {
      await backend.schedules().append({
        actorUserId: "user_ops",
        action: "ops.scheduler.run_now",
        scheduleId: "sched_1",
        projectId: "project-1",
        slot: null,
      });

      const listed = await backend.schedules().listRecent({ limit: 10 });

      expect(listed).toHaveLength(1);
      expect(listed[0]).toMatchObject({ scheduleId: "sched_1", projectId: "project-1" });
    });

    it("answers an empty trail before anything is recorded", async () => {
      expect(await backend.schedules().listRecent({ limit: 10 })).toEqual([]);
    });
  });
}

describe("given the memory operator trails", () => {
  let store: MemoryOpsStore;

  beforeEach(() => {
    store = MemoryOpsStore.create();
  });

  contractCases({
    processes: () => MemoryProcessAuditRepository.create({ store }),
    schedules: () => MemorySchedulerAuditRepository.create({ store }),
  });
});
