import type {
  AuditLogApi,
  AuditLogHistoryEntry,
  AuditLogTargetEntry,
  FindAuditLogByTargetKindInput,
  RecordAuditLogCommand,
  RecordedAuditLogEntry,
} from "@langwatch/audit-log-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { UserApi, UserFullProfile } from "@langwatch/user-contract";
import { describe, expect, it } from "vitest";

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

  /** What this log recorded under the kind, newest first: the n-th write is at second n. */
  async findByTargetKind({
    targetKind,
    limit,
  }: FindAuditLogByTargetKindInput): Promise<AuditLogTargetEntry[]> {
    return this.commands
      .map((command, index) => ({ command, index }))
      .filter(({ command }) => command.targetKind === targetKind)
      .toReversed()
      .slice(0, limit)
      .map(({ command, index }) => ({
        id: `audit-${index}`,
        createdAt: new Date(index * 1000),
        action: command.action,
        targetId: command.targetId ?? null,
        projectId: command.projectId ?? null,
        userId: command.userId ?? null,
        metadata: command.metadata ?? null,
      }));
  }
}

const noUsers = createApiFixture<UserApi>();

const profile = ({
  id,
  name,
  email,
}: Pick<UserFullProfile, "id" | "name" | "email">): UserFullProfile => ({
  id,
  name,
  email,
  emailVerified: true,
  image: null,
  pendingSsoSetup: false,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  lastLoginAt: null,
  deactivatedAt: null,
  lastHomePath: null,
  tracesExplorerTourDismissedAt: null,
});

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
      await ProcessAuditService.create({ auditLog }).append({
        actorUserId: "user-1",
        action: "process_wake_now",
        processName: "gateway_debits",
        projectId: "project-1",
        processKey: "healthy",
        metadata: { previousWakeAt: 17 },
      });
      await SchedulerAuditService.create({ auditLog, users: noUsers }).append({
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

      await ProcessAuditService.create({ auditLog }).append({
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

  describe("when the trails are listed back", () => {
    /** @scenario "The operator trails list what the audit log holds, newest first" */
    it("lists at most the limit of process acts, newest first, from the log it records on", async () => {
      const auditLog = new RecordingAuditLog();
      const trail = ProcessAuditService.create({ auditLog });
      for (const processKey of ["a", "b", "c"]) {
        await trail.append({
          actorUserId: "user-1",
          action: "process_wake_now",
          processName: "gateway_debits",
          projectId: "project-1",
          processKey,
        });
      }
      await QueueAuditService.create({ auditLog }).append({
        actorUserId: "user-1",
        action: "queue_drain_group",
        queueName: "trace-ingest",
        metadata: {},
      });

      const listed = await trail.findRecent({ limit: 2 });

      expect(listed).toEqual([
        {
          id: "audit-2",
          createdAt: 2000,
          action: "process_wake_now",
          targetId: "gateway_debits/project-1/c",
          actorUserId: "user-1",
          metadata: {},
        },
        expect.objectContaining({ targetId: "gateway_debits/project-1/b" }),
      ]);
    });

    /** @scenario "The operator trails list what the audit log holds, newest first" */
    it("answers an empty trail without asking for any names", async () => {
      const auditLog = new RecordingAuditLog();

      expect(await ProcessAuditService.create({ auditLog }).findRecent({ limit: 10 })).toEqual([]);
      expect(
        await SchedulerAuditService.create({ auditLog, users: noUsers }).findRecent({ limit: 10 }),
      ).toEqual([]);
    });
  });

  describe("when scheduler acts are listed by actors with and without names", () => {
    const record = async ({
      auditLog,
      actorUserId,
    }: {
      auditLog: RecordingAuditLog;
      actorUserId: string;
    }) =>
      SchedulerAuditService.create({ auditLog, users: noUsers }).append({
        actorUserId,
        action: "ops.scheduler.run_now",
        scheduleId: `schedule-${actorUserId}`,
        projectId: "project-1",
        slot: null,
      });

    /**
     * @scenario "A scheduler act names its actor by name, else by address"
     * @scenario "A scheduler act by an account that is gone names no one"
     */
    it("names each actor once by name, falls back to the address, and names a gone account no one", async () => {
      const auditLog = new RecordingAuditLog();
      for (const actorUserId of ["user-named", "user-mailed", "user-gone", "user-named"]) {
        await record({ auditLog, actorUserId });
      }
      const asked: string[][] = [];
      const users = createApiFixture<UserApi>({
        getProfiles: async ({ userIds }) => {
          asked.push(userIds);
          return [
            profile({ id: "user-named", name: "Ada", email: "ada@example.com" }),
            profile({ id: "user-mailed", name: null, email: "mailed@example.com" }),
          ];
        },
      });

      const listed = await SchedulerAuditService.create({ auditLog, users }).findRecent({
        limit: 10,
      });

      expect(asked).toEqual([["user-named", "user-gone", "user-mailed"]]);
      expect(listed.map(({ scheduleId, actor, at }) => ({ scheduleId, actor, at }))).toEqual([
        { scheduleId: "schedule-user-named", actor: "Ada", at: "1970-01-01T00:00:03.000Z" },
        { scheduleId: "schedule-user-gone", actor: null, at: "1970-01-01T00:00:02.000Z" },
        {
          scheduleId: "schedule-user-mailed",
          actor: "mailed@example.com",
          at: "1970-01-01T00:00:01.000Z",
        },
        { scheduleId: "schedule-user-named", actor: "Ada", at: "1970-01-01T00:00:00.000Z" },
      ]);
    });
  });
});
