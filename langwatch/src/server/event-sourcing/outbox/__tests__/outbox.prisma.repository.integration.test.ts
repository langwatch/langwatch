/**
 * @vitest-environment node
 *
 * Integration tests for PrismaOutboxRepository — exercises the
 * postgres-specific paths that an in-memory fake cannot model:
 *   - createMany skipDuplicates as the atomic claim primitive
 *   - FOR UPDATE SKIP LOCKED contention between concurrent leasers
 *   - lease recovery after expiry
 */
import { generate } from "@langwatch/ksuid";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";
import { KSUID_RESOURCES } from "../../../../utils/constants";
import { getTestProject } from "../../../../utils/testUtils";
import { prisma } from "../../../db";
import { PrismaOutboxRepository } from "../outbox.prisma.repository";

const reactorName = `test-reactor-${generate(KSUID_RESOURCES.PROJECT)}`;

describe("PrismaOutboxRepository", () => {
  const repo = new PrismaOutboxRepository(prisma);
  let projectId: string;

  beforeAll(async () => {
    const project = await getTestProject("reactor-outbox");
    projectId = project.id;
  });

  afterEach(async () => {
    await prisma.reactorOutbox.deleteMany({ where: { projectId, reactorName } });
  });

  afterAll(async () => {
    // Project / team / org are reused fixtures — don't delete them.
    await prisma.reactorOutbox.deleteMany({ where: { projectId, reactorName } });
  });

  describe("insertIfAbsent", () => {
    describe("when no row exists for (reactorName, dedupKey)", () => {
      it("inserts and returns true", async () => {
        const inserted = await repo.insertIfAbsent({
          projectId,
          reactorName,
          dedupKey: `${projectId}/trigger-A:trace:trace-1`,
          groupKey: `${projectId}/${reactorName}:trigger-A`,
          payload: { triggerId: "trigger-A" },
        });
        expect(inserted).toBe(true);

        const rows = await prisma.reactorOutbox.findMany({
          where: { projectId, reactorName },
        });
        expect(rows).toHaveLength(1);
        expect(rows[0]?.status).toBe("queued");
      });
    });

    describe("when a row exists for (reactorName, dedupKey)", () => {
      it("returns false and leaves the existing row untouched", async () => {
        await repo.insertIfAbsent({
          projectId,
          reactorName,
          dedupKey: `${projectId}/trigger-A:trace:trace-1`,
          groupKey: `${projectId}/${reactorName}:trigger-A`,
          payload: { v: 1 },
        });
        const second = await repo.insertIfAbsent({
          projectId,
          reactorName,
          dedupKey: `${projectId}/trigger-A:trace:trace-1`,
          groupKey: `${projectId}/${reactorName}:trigger-A`,
          payload: { v: 2 },
        });
        expect(second).toBe(false);
        const rows = await prisma.reactorOutbox.findMany({
          where: { projectId, reactorName },
        });
        expect(rows).toHaveLength(1);
        expect((rows[0]?.payload as { v: number }).v).toBe(1);
      });
    });
  });

  describe("leaseNext", () => {
    describe("when two concurrent leasers race on a single queued row", () => {
      it("hands the row to exactly one of them", async () => {
        await repo.insertIfAbsent({
          projectId,
          reactorName,
          dedupKey: "only-one",
          groupKey: `${projectId}/${reactorName}:trigger-A`,
          payload: {},
        });

        const now = new Date();
        const leasedUntil = new Date(now.getTime() + 60_000);

        const [a, b] = await Promise.all([
          repo.leaseNext({ projectId, reactorName, leasedUntil, now }),
          repo.leaseNext({ projectId, reactorName, leasedUntil, now }),
        ]);

        const winners = [a, b].filter((r) => r !== null);
        expect(winners).toHaveLength(1);
      });
    });

    describe("when a row's nextAttemptAt is in the future", () => {
      it("does not lease it", async () => {
        const future = new Date(Date.now() + 60_000);
        await prisma.reactorOutbox.create({
          data: {
            projectId,
            reactorName,
            dedupKey: "backoff",
            groupKey: `${projectId}/${reactorName}:trigger-A`,
            payload: {},
            nextAttemptAt: future,
            status: "failed_retryable",
          },
        });

        const leased = await repo.leaseNext({
          projectId,
          reactorName,
          leasedUntil: new Date(Date.now() + 30_000),
          now: new Date(),
        });
        expect(leased).toBeNull();
      });
    });
  });

  describe("recoverExpiredLeases", () => {
    describe("when a row's leasedUntil has passed", () => {
      it("flips it back to queued", async () => {
        const past = new Date(Date.now() - 60_000);
        await prisma.reactorOutbox.create({
          data: {
            projectId,
            reactorName,
            dedupKey: "expired",
            groupKey: `${projectId}/${reactorName}:trigger-A`,
            payload: {},
            status: "dispatching",
            leasedUntil: past,
            attempts: 1,
          },
        });

        const recovered = await repo.recoverExpiredLeases({
          now: new Date(),
          limit: 10,
        });
        expect(recovered).toBe(1);

        const row = await prisma.reactorOutbox.findFirst({
          where: { projectId, reactorName },
        });
        expect(row?.status).toBe("queued");
        expect(row?.leasedUntil).toBeNull();
      });
    });
  });

  describe("markDispatched", () => {
    describe("when the row is still leased to this worker", () => {
      it("marks it dispatched (scoped by projectId)", async () => {
        await repo.insertIfAbsent({
          projectId,
          reactorName,
          dedupKey: "dispatch-me",
          groupKey: `${projectId}/${reactorName}:trigger-A`,
          payload: {},
        });
        const leased = await repo.leaseNext({
          projectId,
          reactorName,
          leasedUntil: new Date(Date.now() + 60_000),
          now: new Date(),
        });
        expect(leased).not.toBeNull();

        await repo.markDispatched({
          rowId: leased!.id,
          projectId,
          now: new Date(),
        });

        const row = await repo.findById({ rowId: leased!.id, projectId });
        expect(row?.status).toBe("dispatched");
        expect(row?.leasedUntil).toBeNull();
        expect(row?.dispatchedAt).not.toBeNull();
      });
    });
  });

  describe("markRetry", () => {
    describe("when the attempts count no longer matches the leased row", () => {
      it("no-ops so a stale worker cannot clobber a re-leased row", async () => {
        await repo.insertIfAbsent({
          projectId,
          reactorName,
          dedupKey: "cas-guard",
          groupKey: `${projectId}/${reactorName}:trigger-A`,
          payload: {},
        });
        const leased = await repo.leaseNext({
          projectId,
          reactorName,
          leasedUntil: new Date(Date.now() + 60_000),
          now: new Date(),
        });
        // Simulate a concurrent recovery + re-lease bumping attempts.
        await prisma.reactorOutbox.updateMany({
          where: { id: leased!.id, projectId },
          data: { attempts: leased!.attempts + 1 },
        });

        await repo.markRetry({
          rowId: leased!.id,
          projectId,
          attempts: leased!.attempts,
          status: "failed_retryable",
          nextAttemptAt: new Date(Date.now() + 1_000),
          lastError: "stale",
          lastErrorAt: new Date(),
        });

        const row = await repo.findById({ rowId: leased!.id, projectId });
        // Untouched: still dispatching, lastError never written.
        expect(row?.status).toBe("dispatching");
        expect(row?.lastError).toBeNull();
      });
    });

    describe("when promoting an exhausted row to dead", () => {
      it("clears nextAttemptAt to null", async () => {
        await repo.insertIfAbsent({
          projectId,
          reactorName,
          dedupKey: "dead-row",
          groupKey: `${projectId}/${reactorName}:trigger-A`,
          payload: {},
          maxAttempts: 1,
        });
        const leased = await repo.leaseNext({
          projectId,
          reactorName,
          leasedUntil: new Date(Date.now() + 60_000),
          now: new Date(),
        });

        await repo.markRetry({
          rowId: leased!.id,
          projectId,
          attempts: leased!.attempts,
          status: "dead",
          nextAttemptAt: null,
          lastError: "exhausted",
          lastErrorAt: new Date(),
        });

        const row = await repo.findById({ rowId: leased!.id, projectId });
        expect(row?.status).toBe("dead");
        expect(row?.nextAttemptAt).toBeNull();
      });
    });
  });
});
