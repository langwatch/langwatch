/**
 * @vitest-environment node
 *
 * Integration coverage against real Postgres for what a fake Prisma client
 * cannot prove: the messageKey collision race, lease reclaim after an
 * expired (not failed) lease, and prune's processName scoping.
 *
 * `stage()` derives the deployed table's projectId column from tenantId (see
 * prismaOutbox.ts), so every verification query below filters on
 * `projectId: TENANT_ID` to satisfy the multitenancy guard the same way the
 * adapter itself does.
 */
import { nanoid } from "nanoid";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "~/server/db";
import { prismaOutbox } from "../prismaOutbox";

const suffix = nanoid(8);
const PROCESS_NAME = `test-outbox-${suffix}`;
const TENANT_ID = `tenant-outbox-${suffix}`;

describe("prismaOutbox (integration)", () => {
  const outbox = prismaOutbox(prisma);

  afterEach(async () => {
    await prisma.processManagerOutbox.deleteMany({
      where: {
        processName: { startsWith: PROCESS_NAME },
        projectId: TENANT_ID,
      },
    });
  });

  describe("stage — messageKey collapses redeliveries", () => {
    it("lets only one row survive two concurrent stages of the same key", async () => {
      const messageKey = `digest:${nanoid(8)}`;
      const row = {
        intentType: `${PROCESS_NAME}/notify`,
        messageKey,
        tenantId: TENANT_ID,
        payload: "{}",
      };

      await Promise.all([outbox.stage([row]), outbox.stage([row])]);

      const rows = await prisma.processManagerOutbox.findMany({
        where: { processName: PROCESS_NAME, projectId: TENANT_ID, messageKey },
      });
      expect(rows).toHaveLength(1);
    });
  });

  describe("claim — lease", () => {
    it("never lets two concurrent claims take the same row", async () => {
      const messageKey = `lease-race:${nanoid(8)}`;
      await outbox.stage([
        {
          intentType: `${PROCESS_NAME}/notify`,
          messageKey,
          tenantId: TENANT_ID,
          payload: "{}",
        },
      ]);

      const [first, second] = await Promise.all([
        outbox.claim(50, 30_000),
        outbox.claim(50, 30_000),
      ]);
      const claimedIds = [...first, ...second]
        .filter((r) => r.messageKey === messageKey)
        .map((r) => r.id);
      expect(claimedIds).toHaveLength(1);
    });

    it("reclaims an expired lease without losing the attempt count", async () => {
      const messageKey = `expired-lease:${nanoid(8)}`;
      await outbox.stage([
        {
          intentType: `${PROCESS_NAME}/notify`,
          messageKey,
          tenantId: TENANT_ID,
          payload: "{}",
        },
      ]);
      const claimed = (await outbox.claim(50, 30_000)).find(
        (r) => r.messageKey === messageKey,
      );
      expect(claimed).toBeDefined();

      // A crashed worker never calls fail() or settle() — it just leaves the
      // lease to expire. Simulate that directly rather than going through
      // fail(), and stamp a non-zero attempt count to prove it survives.
      await prisma.processManagerOutbox.updateMany({
        where: { messageKey, projectId: TENANT_ID },
        data: { leasedUntil: new Date(Date.now() - 1000), attempts: 3 },
      });

      const reclaimed = (await outbox.claim(50, 30_000)).find(
        (r) => r.messageKey === messageKey,
      );
      expect(reclaimed?.attempt).toBe(3);
    });
  });

  describe("settle", () => {
    it("marks the row dispatched so it is never claimed again", async () => {
      const messageKey = `settle:${nanoid(8)}`;
      await outbox.stage([
        {
          intentType: `${PROCESS_NAME}/notify`,
          messageKey,
          tenantId: TENANT_ID,
          payload: "{}",
        },
      ]);
      const claimed = (await outbox.claim(50, 30_000)).find(
        (r) => r.messageKey === messageKey,
      );
      await outbox.settle(claimed!.id);

      const again = await outbox.claim(50, 30_000);
      expect(again.some((r) => r.messageKey === messageKey)).toBe(false);

      const row = await prisma.processManagerOutbox.findFirst({
        where: { messageKey, projectId: TENANT_ID },
      });
      expect(row?.status).toBe("dispatched");
    });
  });

  describe("fail", () => {
    it("schedules a backoff for a retryable failure and releases the lease", async () => {
      const messageKey = `retry:${nanoid(8)}`;
      await outbox.stage([
        {
          intentType: `${PROCESS_NAME}/notify`,
          messageKey,
          tenantId: TENANT_ID,
          payload: "{}",
        },
      ]);
      const claimed = (await outbox.claim(50, 30_000)).find(
        (r) => r.messageKey === messageKey,
      );
      await outbox.fail(claimed!.id, true, 60_000);

      const row = await prisma.processManagerOutbox.findFirst({
        where: { messageKey, projectId: TENANT_ID },
      });
      expect(row?.status).toBe("pending");
      expect(row?.attempts).toBe(1);
      expect(row?.leaseToken).toBeNull();
      expect(row?.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());

      // Not yet claimable — its backoff hasn't elapsed.
      const again = await outbox.claim(50, 30_000);
      expect(again.some((r) => r.messageKey === messageKey)).toBe(false);
    });

    it("marks a terminal failure dead so it is never reclaimed", async () => {
      const messageKey = `dead:${nanoid(8)}`;
      await outbox.stage([
        {
          intentType: `${PROCESS_NAME}/notify`,
          messageKey,
          tenantId: TENANT_ID,
          payload: "{}",
        },
      ]);
      const claimed = (await outbox.claim(50, 30_000)).find(
        (r) => r.messageKey === messageKey,
      );
      await outbox.fail(claimed!.id, false, 0);

      const row = await prisma.processManagerOutbox.findFirst({
        where: { messageKey, projectId: TENANT_ID },
      });
      expect(row?.status).toBe("dead");

      const again = await outbox.claim(50, 30_000);
      expect(again.some((r) => r.messageKey === messageKey)).toBe(false);
    });
  });

  describe("prune", () => {
    it("only removes dispatched rows for the given processName", async () => {
      const otherProcessName = `${PROCESS_NAME}-other`;
      const mineKey = `prune-mine:${nanoid(8)}`;
      const otherKey = `prune-other:${nanoid(8)}`;

      await outbox.stage([
        {
          intentType: `${PROCESS_NAME}/notify`,
          messageKey: mineKey,
          tenantId: TENANT_ID,
          payload: "{}",
        },
        {
          intentType: `${otherProcessName}/notify`,
          messageKey: otherKey,
          tenantId: TENANT_ID,
          payload: "{}",
        },
      ]);
      // Both rows are eligible from one global claim — claim() has no
      // processName filter (there is no such parameter on the port).
      const claimed = await outbox.claim(50, 30_000);
      const mine = claimed.find((r) => r.messageKey === mineKey);
      const other = claimed.find((r) => r.messageKey === otherKey);
      await outbox.settle(mine!.id);
      await outbox.settle(other!.id);

      const removed = await outbox.prune(PROCESS_NAME, Date.now() + 60_000);
      expect(removed).toBe(1);

      const otherRow = await prisma.processManagerOutbox.findFirst({
        where: {
          processName: otherProcessName,
          projectId: TENANT_ID,
          messageKey: otherKey,
        },
      });
      expect(otherRow).not.toBeNull();
    });
  });
});
