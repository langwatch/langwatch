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
import { prisma } from "../../../db";
import { PrismaOutboxRepository } from "../outbox.prisma.repository";

const reactorName = `test-reactor-${generate(KSUID_RESOURCES.PROJECT)}`;

async function ensureProject(): Promise<string> {
  const projectId = `proj-${generate(KSUID_RESOURCES.PROJECT)}`;
  // Minimal Project — relies on the test DB having Organization/Team
  // fixtures available. We borrow whichever team already exists; if
  // none, the test is skipped.
  const team = await prisma.team.findFirst();
  if (!team) {
    throw new Error(
      "ReactorOutbox integration tests need an existing Team fixture",
    );
  }
  await prisma.project.create({
    data: {
      id: projectId,
      name: "ReactorOutbox integration test",
      slug: projectId,
      apiKey: `key-${projectId}`,
      teamId: team.id,
      framework: "test",
      language: "ts",
    },
  });
  return projectId;
}

describe("PrismaOutboxRepository", () => {
  const repo = new PrismaOutboxRepository(prisma);
  let projectId: string;
  const createdProjectIds: string[] = [];

  beforeAll(async () => {
    projectId = await ensureProject();
    createdProjectIds.push(projectId);
  });

  afterEach(async () => {
    await prisma.reactorOutbox.deleteMany({ where: { reactorName } });
  });

  afterAll(async () => {
    if (createdProjectIds.length > 0) {
      await prisma.project.deleteMany({
        where: { id: { in: createdProjectIds } },
      });
    }
  });

  describe("insertIfAbsent", () => {
    describe("when no row exists for (reactorName, dedupKey)", () => {
      it("inserts and returns true", async () => {
        const inserted = await repo.insertIfAbsent({
          projectId,
          reactorName,
          dedupKey: "trigger-A:trace-1",
          groupKey: projectId,
          payload: { triggerId: "trigger-A" },
        });
        expect(inserted).toBe(true);

        const rows = await prisma.reactorOutbox.findMany({
          where: { reactorName },
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
          dedupKey: "trigger-A:trace-1",
          groupKey: projectId,
          payload: { v: 1 },
        });
        const second = await repo.insertIfAbsent({
          projectId,
          reactorName,
          dedupKey: "trigger-A:trace-1",
          groupKey: projectId,
          payload: { v: 2 },
        });
        expect(second).toBe(false);
        const rows = await prisma.reactorOutbox.findMany({
          where: { reactorName },
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
          groupKey: projectId,
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
            groupKey: projectId,
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
            groupKey: projectId,
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
          where: { reactorName },
        });
        expect(row?.status).toBe("queued");
        expect(row?.leasedUntil).toBeNull();
      });
    });
  });
});
