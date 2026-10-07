import type {
  AuditLogApi,
  AuditLogHistoryEntry,
  RecordAuditLogCommand,
  RecordedAuditLogEntry,
} from "@langwatch/audit-log-contract";
import { describe, expect, it } from "vitest";

import { MemoryOpsStore } from "../../repositories/memory/memory.ops.store.ts";
import { MemoryProcessAuditRepository } from "../../repositories/memory/memory.process-audit.repository.ts";
import { MemorySchedulerAuditRepository } from "../../repositories/memory/memory.scheduler-audit.repository.ts";
import { ProcessAuditService } from "../process-audit.service.ts";
import { QueueAuditService } from "../queue-audit.service.ts";
import { SchedulerAuditService } from "../scheduler-audit.service.ts";

class RecordingAuditLog implements AuditLogApi {
  readonly commands: RecordAuditLogCommand[] = [];

  async record(command: RecordAuditLogCommand): Promise<RecordedAuditLogEntry> {
    await this.write(command);
    return { id: "audit", occurredAt: 0 };
  }

  async hasRecordedSince(): Promise<boolean> {
    return false;
  }

  private async write(command: RecordAuditLogCommand): Promise<void> {
    this.commands.push(command);
  }

  async listEntityHistory(): Promise<AuditLogHistoryEntry[]> {
    return [];
  }
}

describe("given the operator surfaces record through the audit-log port", () => {
  describe("when an operator drains a queue, wakes a process and runs a schedule", () => {
    /**
     * @scenario "Operator actions reach the audit log through its port"
     * @scenario "Process and scheduler operator acts are recorded through the audit log"
     */
    it("records each act on the port with its target and metadata", async () => {
      const auditLog = new RecordingAuditLog();

      await QueueAuditService.create({ auditLog }).append({
        actorUserId: "user-1",
        action: "queue_drain_group",
        queueName: "trace-ingest",
        metadata: { group: "project-1" },
      });
      const store = MemoryOpsStore.create();
      await ProcessAuditService.create({
        auditLog,
        history: MemoryProcessAuditRepository.create({ store }),
      }).append({
        actorUserId: "user-1",
        action: "process_wake_now",
        processName: "gateway_debits",
        projectId: "project-1",
        processKey: "healthy",
        metadata: { previousWakeAt: 17 },
      });
      await SchedulerAuditService.create({
        auditLog,
        history: MemorySchedulerAuditRepository.create({ store }),
      }).append({
        actorUserId: "user-1",
        action: "ops.scheduler.run_now",
        scheduleId: "schedule-1",
        projectId: "project-1",
        slot: null,
      });

      expect(auditLog.commands).toEqual([
        {
          userId: "user-1",
          action: "queue_drain_group",
          targetKind: "queue",
          targetId: "trace-ingest",
          metadata: { group: "project-1" },
        },
        {
          userId: "user-1",
          projectId: "project-1",
          action: "process_wake_now",
          targetKind: "process_instance",
          targetId: "gateway_debits/project-1/healthy",
          metadata: { previousWakeAt: 17 },
        },
        {
          userId: "user-1",
          projectId: "project-1",
          action: "ops.scheduler.run_now",
          targetKind: "scheduled_job",
          targetId: "schedule-1",
          metadata: { slot: null },
        },
      ]);
    });
  });

  describe("when an operator redrives a whole fleet's dead letters", () => {
    /** @scenario "Process and scheduler operator acts are recorded through the audit log" */
    it("names the fleet rather than a made-up instance and leaves the project out", async () => {
      const auditLog = new RecordingAuditLog();

      await ProcessAuditService.create({
        auditLog,
        history: MemoryProcessAuditRepository.create({ store: MemoryOpsStore.create() }),
      }).append({
        actorUserId: "user-1",
        action: "process_redrive_dead_letters",
        processName: "gateway_debits",
        projectId: null,
        processKey: null,
        metadata: { moved: 12 },
      });

      expect(auditLog.commands).toEqual([
        {
          userId: "user-1",
          action: "process_redrive_dead_letters",
          targetKind: "process_instance",
          targetId: "fleet",
          metadata: { moved: 12 },
        },
      ]);
    });
  });
});
