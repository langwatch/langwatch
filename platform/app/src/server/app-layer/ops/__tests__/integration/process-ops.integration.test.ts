import { nanoid } from "nanoid";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "~/server/db";
import { PrismaProcessStore } from "~/server/event-sourcing/process-manager/stores/prismaProcessStore";
import { ManagerExplorerService } from "../../manager-explorer.service";
import { ProcessAuditRepository } from "../../process-audit.repository";
import { ProcessOpsPrismaRepository } from "../../repositories/process-ops.prisma.repository";

/**
 * The fleet repository and the audited actions against a real Postgres.
 * Rows are namespaced by a per-run process name so parallel runs and leftover
 * data cannot collide, and reaped in afterAll.
 *
 * Spec: specs/ops/process-manager-visibility.feature
 */
const ns = `opstest.${nanoid(8)}`;
const PROJECT = "project_opstest";
const NOW = Date.now();

const fleet = new ProcessOpsPrismaRepository(prisma);
const service = new ManagerExplorerService({
  store: new PrismaProcessStore(prisma),
  fleet,
  audit: new ProcessAuditRepository(prisma),
});

const ACTOR = `user_opstest_${nanoid(6)}`;

async function seedInstance(params: {
  processKey: string;
  nextWakeAt: Date | null;
}) {
  await prisma.processManagerInstance.create({
    data: {
      processName: ns,
      projectId: PROJECT,
      processKey: params.processKey,
      tenantId: PROJECT,
      state: { phase: "waiting" },
      revision: 1,
      nextWakeAt: params.nextWakeAt,
      updatedAt: new Date(NOW),
    },
  });
}

async function seedMessage(params: {
  processKey: string;
  messageKey: string;
  status: "pending" | "dead" | "dispatched";
  nextAttemptAt: Date;
  leasedUntil?: Date | null;
  leaseToken?: string | null;
}) {
  const row = await prisma.processManagerOutbox.create({
    data: {
      processName: ns,
      projectId: PROJECT,
      processKey: params.processKey,
      tenantId: PROJECT,
      messageKey: params.messageKey,
      intentType: "opstest.intent",
      payload: { messageKey: params.messageKey },
      traceCarrier: {
        traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
      },
      status: params.status,
      nextAttemptAt: params.nextAttemptAt,
      leasedUntil: params.leasedUntil ?? null,
      leaseToken: params.leaseToken ?? null,
      createdAt: new Date(NOW),
      updatedAt: new Date(NOW),
    },
  });
  return row.id;
}

afterAll(async () => {
  await prisma.processManagerOutbox.deleteMany({
    where: { processName: ns, projectId: PROJECT },
  });
  await prisma.processManagerInstance.deleteMany({
    where: { processName: ns, projectId: PROJECT },
  });
  await prisma.auditLog.deleteMany({
    where: { targetKind: "process_instance", targetId: { startsWith: ns } },
  });
});

describe("process ops against a real Postgres", () => {
  describe("given instances and outbox messages in every trouble state", () => {
    it("counts them per process name, each in its own bucket", async () => {
      await seedInstance({
        processKey: "stuck",
        nextWakeAt: new Date(NOW - 2 * 60 * 1000),
      });
      await seedInstance({
        processKey: "healthy",
        nextWakeAt: new Date(NOW + 60 * 60 * 1000),
      });
      await seedMessage({
        processKey: "healthy",
        messageKey: "fresh",
        status: "pending",
        nextAttemptAt: new Date(NOW + 5_000),
      });
      await seedMessage({
        processKey: "stuck",
        messageKey: "lapsed",
        status: "pending",
        nextAttemptAt: new Date(NOW - 60 * 1000),
        leasedUntil: new Date(NOW - 30 * 1000),
        leaseToken: `lease_${nanoid(6)}`,
      });
      await seedMessage({
        processKey: "stuck",
        messageKey: "overdue",
        status: "pending",
        nextAttemptAt: new Date(NOW - 6 * 60 * 1000),
      });
      await seedMessage({
        processKey: "stuck",
        messageKey: "dead-1",
        status: "dead",
        nextAttemptAt: new Date(NOW - 60 * 1000),
      });
      await seedMessage({
        processKey: "stuck",
        messageKey: "dead-2",
        status: "dead",
        nextAttemptAt: new Date(NOW - 60 * 1000),
      });

      const counts = await fleet.countByProcessName({
        now: NOW,
        overdueWakeMs: 60 * 1000,
        overduePendingMs: 5 * 60 * 1000,
      });
      const row = counts.find((c) => c.processName === ns);
      expect(row).toMatchObject({
        instances: 2,
        overdueWakes: 1,
        pendingMessages: 3,
        overduePending: 1,
        lapsedLeases: 1,
        deadMessages: 2,
      });
    });

    it("lists instances with their per-row outbox trouble, searchably", async () => {
      const all = await fleet.findInstances({
        processName: ns,
        page: 1,
        pageSize: 10,
      });
      expect(all.total).toBe(2);
      const stuck = all.instances.find((i) => i.processKey === "stuck");
      expect(stuck?.deadMessages).toBe(2);
      expect(stuck?.pendingMessages).toBe(2);

      const searched = await fleet.findInstances({
        processName: ns,
        page: 1,
        pageSize: 10,
        search: "HEALTH",
      });
      expect(searched.total).toBe(1);
      expect(searched.instances[0]?.processKey).toBe("healthy");
    });

    it("serves the outbox page with the trace id parsed from the carrier", async () => {
      const outbox = await fleet.findOutboxMessages({
        ref: { processName: ns, projectId: PROJECT, processKey: "stuck" },
        page: 1,
        pageSize: 10,
      });
      expect(outbox.total).toBe(4);
      expect(outbox.messages[0]?.traceId).toBe(
        "4bf92f3577b34da6a3ce929d0e0e4736",
      );
    });
  });

  describe("when the operator triggers wake now", () => {
    /** @scenario "An operator wakes a stuck process now" */
    it("sets the wake to now and lands in the audit trail with the previous wake", async () => {
      const before = await prisma.processManagerInstance.findUniqueOrThrow({
        where: {
          projectId: PROJECT,
          processName_projectId_processKey: {
            processName: ns,
            projectId: PROJECT,
            processKey: "healthy",
          },
        },
      });

      const result = await service.wakeNow({
        ref: { processName: ns, projectId: PROJECT, processKey: "healthy" },
        actorUserId: ACTOR,
      });
      expect(result.woke).toBe(true);

      const after = await prisma.processManagerInstance.findUniqueOrThrow({
        where: {
          projectId: PROJECT,
          processName_projectId_processKey: {
            processName: ns,
            projectId: PROJECT,
            processKey: "healthy",
          },
        },
      });
      expect(after.nextWakeAt!.getTime()).toBeLessThanOrEqual(Date.now());

      const audit = await prisma.auditLog.findFirst({
        where: { action: "process_wake_now", userId: ACTOR },
      });
      expect(audit?.targetId).toBe(`${ns}/${PROJECT}/healthy`);
      expect(audit?.metadata).toMatchObject({
        previousWakeAt: before.nextWakeAt!.getTime(),
      });
    });
  });

  describe("when the operator redrives a dead message", () => {
    /** @scenario "A dead message is redriven, once" */
    it("returns it to pending due now with a fresh budget, audits it, and a second redrive is a no-op", async () => {
      const dead = await prisma.processManagerOutbox.findFirstOrThrow({
        where: { processName: ns, projectId: PROJECT, messageKey: "dead-1" },
      });

      const ref = { processName: ns, projectId: PROJECT, processKey: "stuck" };
      const first = await service.redriveDeadMessage({
        ref,
        messageId: dead.id,
        actorUserId: ACTOR,
      });
      expect(first.redriven).toBe(true);

      const after = await prisma.processManagerOutbox.findFirstOrThrow({
        where: { id: dead.id, projectId: PROJECT },
      });
      expect(after.status).toBe("pending");
      expect(after.attempts).toBe(0);
      expect(after.nextAttemptAt.getTime()).toBeLessThanOrEqual(Date.now());

      const second = await service.redriveDeadMessage({
        ref,
        messageId: dead.id,
        actorUserId: ACTOR,
      });
      expect(second.redriven).toBe(false);

      const auditRows = await prisma.auditLog.findMany({
        where: { action: "process_redrive_dead_message", userId: ACTOR },
      });
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0]?.metadata).toMatchObject({ messageKey: "dead-1" });
    });
  });

  describe("when the operator releases a lapsed lease", () => {
    /** @scenario "An operator releases a lapsed lease knowingly" */
    it("frees only the lapsed lease — a live one stays under its delivery", async () => {
      const ref = { processName: ns, projectId: PROJECT, processKey: "stuck" };
      const lapsed = await prisma.processManagerOutbox.findFirstOrThrow({
        where: { processName: ns, projectId: PROJECT, messageKey: "lapsed" },
      });
      const released = await service.releaseLapsedLease({
        ref,
        messageId: lapsed.id,
        actorUserId: ACTOR,
      });
      expect(released.released).toBe(true);

      const after = await prisma.processManagerOutbox.findFirstOrThrow({
        where: { id: lapsed.id, projectId: PROJECT },
      });
      expect(after.leaseToken).toBeNull();
      expect(after.leasedUntil).toBeNull();
      expect(after.nextAttemptAt.getTime()).toBeLessThanOrEqual(Date.now());

      const liveId = await seedMessage({
        processKey: "stuck",
        messageKey: "live-lease",
        status: "pending",
        nextAttemptAt: new Date(NOW - 60 * 1000),
        leasedUntil: new Date(Date.now() + 60 * 1000),
        leaseToken: `lease_${nanoid(6)}`,
      });
      const refused = await service.releaseLapsedLease({
        ref,
        messageId: liveId,
        actorUserId: ACTOR,
      });
      expect(refused.released).toBe(false);
      const live = await prisma.processManagerOutbox.findFirstOrThrow({
        where: { id: liveId, projectId: PROJECT },
      });
      expect(live.leaseToken).not.toBeNull();
    });
  });
});
