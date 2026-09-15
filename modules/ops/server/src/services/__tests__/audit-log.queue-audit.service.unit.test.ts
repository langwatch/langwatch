import type {
  AuditLogApi,
  AuditLogHistoryEntry,
  RecordAuditLogCommand,
} from "@langwatch/audit-log-contract";
import { describe, expect, it } from "vitest";
import { QueueAuditAdapter } from "../audit-log.queue-audit.service.ts";
import { PrismaProcessAuditRepository } from "../../repositories/prisma/prisma.process-audit.repository.ts";
import { PrismaSchedulerAuditRepository } from "../../repositories/prisma/prisma.scheduler-audit.repository.ts";

class RecordingAuditLog implements AuditLogApi {
  readonly commands: RecordAuditLogCommand[] = [];

  async record(command: RecordAuditLogCommand): Promise<void> {
    this.commands.push(command);
  }

  async listEntityHistory(): Promise<AuditLogHistoryEntry[]> {
    return [];
  }
}

/** A client that fails every call, so a write reaching Prisma is a failure. */
const refusingPrisma = new Proxy(
  {},
  {
    get: () =>
      new Proxy(
        {},
        {
          get:
            () =>
            (...args: unknown[]) => {
              throw new Error(`an operator write reached the audit table: ${JSON.stringify(args)}`);
            },
        },
      ),
  },
) as never;

describe("given the operator surfaces record through the audit-log port", () => {
  describe("when an operator drains a queue, wakes a process and runs a schedule", () => {
    /** @scenario "Operator actions reach the audit log through its port" */
    it("records each act on the port with its target and metadata", async () => {
      const auditLog = new RecordingAuditLog();

      await QueueAuditAdapter.create({ auditLog }).append({
        actorUserId: "user-1",
        action: "queue_drain_group",
        queueName: "trace-ingest",
        metadata: { group: "project-1" },
      });
      await PrismaProcessAuditRepository.create({ prisma: refusingPrisma, auditLog }).append({
        actorUserId: "user-1",
        action: "process_wake_now",
        processName: "gateway_debits",
        projectId: "project-1",
        processKey: "healthy",
        metadata: { previousWakeAt: 17 },
      });
      await PrismaSchedulerAuditRepository.create({
        database: refusingPrisma,
        auditLog,
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
});
