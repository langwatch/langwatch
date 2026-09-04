/**
 * Proves the LangWatchQL self-provision advisory lock actually SERIALIZES
 * concurrent holders. Advisory locks are a real Postgres primitive — a mock
 * cannot demonstrate that a second caller blocks until the first releases — so
 * this runs against the test Postgres (it names `prisma`, which places it in
 * the datastore lane).
 *
 * @see ../selfProvisionLock.ts
 * @see ../../../../tasks/provisionLwql.ts
 */
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "~/server/db";
import {
  LWQL_SELF_PROVISION_LOCK_KEY,
  withLwqlSelfProvisionLock,
} from "../selfProvisionLock";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("Feature: LangWatchQL self-provision boot lock", () => {
  afterEach(() => {
    // Transaction-scoped advisory locks release when their transaction ends,
    // so nothing to clean up; the hook documents that these tests leave no
    // rows or held locks behind.
  });

  describe("when two pods run the convergence concurrently", () => {
    /** @scenario "Concurrent self-provision runs are serialized by the advisory lock" */
    it("never lets the two locked bodies overlap", async () => {
      let inFlight = 0;
      let maxInFlight = 0;
      const order: string[] = [];

      const critical = async (tag: string) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        order.push(`enter:${tag}`);
        // Hold the lock long enough that, unserialized, the second caller
        // would enter while the first is still inside.
        await sleep(150);
        order.push(`exit:${tag}`);
        inFlight -= 1;
      };

      await Promise.all([
        withLwqlSelfProvisionLock({ prisma }, () => critical("a")),
        withLwqlSelfProvisionLock({ prisma }, () => critical("b")),
      ]);

      // The lock is a mutex over one global key, so at no instant may two
      // bodies be inside it: the second transaction blocks on
      // pg_advisory_xact_lock until the first commits and releases.
      expect(maxInFlight).toBe(1);
      // One body fully finishes before the other starts — no interleaving.
      expect(order).toEqual([
        order[0],
        order[0]?.replace("enter", "exit"),
        order[2],
        order[2]?.replace("enter", "exit"),
      ]);
      expect(order[0]).not.toBe(order[2]);
    });
  });

  describe("when acquiring the lock", () => {
    /** @scenario "The lock is a transaction-scoped Postgres advisory lock on the global key" */
    it("holds a session-level count while inside and releases it after", async () => {
      // pg_advisory_xact_lock surfaces in pg_locks under `classid`/`objid`
      // derived from the 64-bit key. Rather than reconstruct that split, prove
      // the lock is held ONLY for the transaction's duration: a fresh
      // try-acquire on the same key from another connection fails while held
      // and succeeds once released.
      const key = LWQL_SELF_PROVISION_LOCK_KEY;

      const heldDuringBody = await withLwqlSelfProvisionLock(
        { prisma },
        async () => {
          const rows = await prisma.$queryRaw<Array<{ acquired: boolean }>>`
            -- @tenancy: test probe on a global boot lock, no tenant scope
            SELECT pg_try_advisory_xact_lock(hashtextextended(${key}, 0)) AS acquired`;
          // A separate implicit transaction (this $queryRaw) tries the same
          // key while the outer transaction still holds it — it must fail.
          return rows[0]?.acquired ?? true;
        },
      );
      expect(heldDuringBody).toBe(false);

      // After release, a fresh try-acquire on a throwaway transaction succeeds.
      const acquiredAfter = await prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<Array<{ acquired: boolean }>>`
          -- @tenancy: test probe on a global boot lock, no tenant scope
          SELECT pg_try_advisory_xact_lock(hashtextextended(${key}, 0)) AS acquired`;
        return rows[0]?.acquired ?? false;
      });
      expect(acquiredAfter).toBe(true);
    });
  });
});
